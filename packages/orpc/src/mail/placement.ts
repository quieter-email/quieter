import { createHash, randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  mailbox,
  mailPlacementOperation,
  mailSnooze,
  managedMailMessage,
} from "@quieter/database/schema";
import {
  batchModifyMessages,
  getGmailCaptureMetadata,
  isGmailServiceError,
} from "@quieter/gmail";
import type {
  MailMutationResult,
  MailMutationTargetResult,
} from "@quieter/mail/data-plane";
import { reportError } from "@quieter/observability";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { consumeRateLimit } from "../abuse-protection";
import { callGmail } from "../gmail-request";
import type { MailRequestContext } from "../gmail-request";
import { refreshGmailCapturedMessageMetadata } from "../mail-capture";
import { publishMailboxChange } from "../mailbox-changes";
import { appendManagedMailboxContentChange } from "../managed-mail/changes";
import {
  appendSnoozeContentChange,
  MAIL_SNOOZE_LIVE_STATUSES,
} from "../snooze/state";
import type { MailInputs } from "./inputs";
import { authorizeMailPlacement } from "./placement-access";
import {
  loadMailPlacementAssociations,
  loadMailPlacementSnapshot,
} from "./placement-admission";
import { resolvePlacementMessageIds } from "./placement-model";
import type { PlacementMessage } from "./placement-model";

export type MailSnoozePlacement = {
  id: string;
  version: number;
  leaseToken: string | null;
} & (
  | { kind: "snooze-hide" }
  | {
      kind: "snooze-return";
      trigger: "due" | "manual";
    }
);

const lockPlacementSnooze = async (input: {
  database: Pick<typeof db, "select">;
  guard: MailSnoozePlacement;
  mailboxId: string;
  threadId: string;
  userId: string;
  requestId: string;
}) => {
  const [current] = await input.database
    .select()
    .from(mailSnooze)
    .where(
      and(
        eq(mailSnooze.id, input.guard.id),
        eq(mailSnooze.mailboxId, input.mailboxId),
        eq(mailSnooze.threadId, input.threadId)
      )
    )
    .for("update");
  if (
    current === undefined ||
    current.version !== input.guard.version ||
    current.leaseToken !== input.guard.leaseToken ||
    current.actorUserId !== input.userId ||
    (input.guard.kind === "snooze-hide"
      ? current.status !== "preparing" ||
        current.hideRequestId !== input.requestId
      : current.status !== "returning" ||
        current.returnRequestId !== input.requestId)
  ) {
    throw new ORPCError("CONFLICT", {
      message: "This snooze changed. Refresh before trying again.",
    });
  }
  return current;
};

export const supersedePendingMailPlacement = async (input: {
  context: MailRequestContext;
  mailboxId: string;
  matchHiddenMessageIdsOnly?: boolean;
  messageId?: string;
  messageIds?: string[];
  retireSnoozes?: boolean;
  threadIds?: string[];
}) => {
  const requestedMessageIds = [
    ...new Set([
      ...(input.messageIds ?? []),
      ...(input.messageId === undefined ? [] : [input.messageId]),
    ]),
  ];
  const requestedThreadIds =
    input.threadIds === undefined ? [] : [...new Set(input.threadIds)];
  if (requestedMessageIds.length === 0 && requestedThreadIds.length === 0) {
    return;
  }
  const selected = await authorizeMailPlacement(input.context, input.mailboxId);
  let threadIds = requestedThreadIds;
  if (requestedMessageIds.length > 0) {
    const associations =
      selected.provider === "managed"
        ? await loadMailPlacementAssociations({
            context: input.context,
            database: db,
            mailboxId: input.mailboxId,
            messageIds: requestedMessageIds,
            provider: selected.provider,
          })
        : await callGmail(
            input.context,
            input.mailboxId,
            async (accessToken) =>
              await loadMailPlacementAssociations({
                accessToken,
                context: input.context,
                database: db,
                mailboxId: input.mailboxId,
                messageIds: requestedMessageIds,
                provider: selected.provider,
              })
          );
    threadIds = [
      ...new Set([...threadIds, ...associations.map((item) => item.threadId)]),
    ];
  }
  const messageConditions = requestedMessageIds.map(
    (id) =>
      sql`(${mailPlacementOperation.messageIds} @> ${JSON.stringify([id])}::text::jsonb or ${mailPlacementOperation.requestedMessageIds} @> ${JSON.stringify([id])}::text::jsonb)`
  );
  const hiddenMessageConditions = requestedMessageIds.map(
    (id) =>
      sql`${mailSnooze.hiddenMessageIds} @> ${JSON.stringify([id])}::text::jsonb`
  );
  const targetCondition =
    requestedMessageIds.length === 0
      ? inArray(mailPlacementOperation.threadId, threadIds)
      : or(
          ...(threadIds.length > 0
            ? [inArray(mailPlacementOperation.threadId, threadIds)]
            : []),
          ...messageConditions
        );
  const retireSnoozes = input.retireSnoozes !== false;
  const committed = await db.transaction(async (tx) => {
    await tx
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(eq(mailbox.id, input.mailboxId))
      .for("update");
    const retired =
      retireSnoozes && threadIds.length > 0
        ? await tx
            .update(mailSnooze)
            .set({
              code: "newer_intent",
              leaseToken: null,
              leaseUntil: null,
              message: null,
              nextWakeAt: null,
              status: "superseded",
              updatedAt: new Date(),
              version: sql`${mailSnooze.version} + 1`,
            })
            .where(
              and(
                eq(mailSnooze.mailboxId, input.mailboxId),
                inArray(mailSnooze.threadId, threadIds),
                inArray(mailSnooze.status, MAIL_SNOOZE_LIVE_STATUSES),
                input.matchHiddenMessageIdsOnly === true &&
                  hiddenMessageConditions.length > 0
                  ? or(...hiddenMessageConditions)
                  : undefined
              )
            )
            .returning({ threadId: mailSnooze.threadId })
        : [];
    const superseded = await tx
      .update(mailPlacementOperation)
      .set({
        code: "newer_intent",
        message:
          "A newer action changed this conversation. Refresh to see its current state.",
        status: "superseded",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mailPlacementOperation.mailboxId, input.mailboxId),
          inArray(mailPlacementOperation.status, ["pending", "submitting"]),
          targetCondition
        )
      )
      .returning({ id: mailPlacementOperation.id });
    const interrupted =
      selected.provider === "managed" && superseded.length > 0
        ? await tx
            .select({ threadId: mailSnooze.threadId })
            .from(mailSnooze)
            .where(
              and(
                eq(mailSnooze.mailboxId, input.mailboxId),
                inArray(mailSnooze.status, MAIL_SNOOZE_LIVE_STATUSES),
                or(
                  inArray(
                    mailSnooze.hideOperationId,
                    superseded.map(({ id }) => id)
                  ),
                  inArray(
                    mailSnooze.returnOperationId,
                    superseded.map(({ id }) => id)
                  )
                )
              )
            )
        : [];
    const affected = [...retired, ...interrupted];
    return affected.length > 0
      ? await appendSnoozeContentChange(tx, {
          mailboxId: input.mailboxId,
          provider: selected.provider,
          threadIds: affected.map(({ threadId }) => threadId),
        })
      : null;
  });
  await publishMailboxChange(committed);
};

const toPlacementResult = (
  operation: typeof mailPlacementOperation.$inferSelect,
  replayed: boolean
): MailMutationTargetResult => ({
  code:
    operation.status === "applied"
      ? undefined
      : (operation.code ?? `placement_${operation.status}`),
  message:
    operation.status === "applied"
      ? undefined
      : (operation.message ??
        "This action is still being confirmed. Refresh before trying again."),
  messageIds: operation.messageIds,
  operationId: operation.id,
  replayed,
  status: operation.status === "applied" ? "applied" : "failed",
  threadId: operation.threadId,
});

export const hashMailPlacementRequest = ({
  actorUserId,
  input,
  snooze,
}: {
  actorUserId: string;
  snooze?: MailSnoozePlacement;
  input: Pick<MailInputs["applyChanges"], "mailboxId" | "targets"> & {
    command: { kind: "set-placement"; placement: "done" | "inbox" };
  };
}): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        actorUserId,
        command: input.command,
        mailboxId: input.mailboxId,
        snooze:
          snooze === undefined
            ? undefined
            : {
                id: snooze.id,
                kind: snooze.kind,
                ...(snooze.kind === "snooze-return"
                  ? { trigger: snooze.trigger }
                  : {}),
                version: snooze.version,
              },
        targets: input.targets
          .map((target) => ({
            messageIds: [...new Set(target.messageIds)].toSorted(),
            threadId: target.threadId,
          }))
          .toSorted((left, right) =>
            left.threadId.localeCompare(right.threadId)
          ),
      })
    )
    .digest("hex");

export const applyMailPlacement = async ({
  chargeRateLimit = true,
  context: requestContext,
  input,
  prefetched,
  snooze,
}: {
  chargeRateLimit?: boolean;
  context: MailRequestContext;
  prefetched?: {
    associations?: readonly { id: string; threadId: string }[];
    snapshot?: {
      incomingMessageIds: string[];
      messages: PlacementMessage[];
    };
  };
  snooze?: MailSnoozePlacement;
  input: MailInputs["applyChanges"] & {
    command: { kind: "set-placement"; placement: "done" | "inbox" };
  };
}): Promise<MailMutationResult> => {
  const deadline = AbortSignal.timeout(30_000);
  const context: MailRequestContext = {
    ...requestContext,
    signal: requestContext.signal
      ? AbortSignal.any([requestContext.signal, deadline])
      : deadline,
  };
  const selected = await authorizeMailPlacement(context, input.mailboxId);
  const { requestId } = input;
  if (requestId === undefined) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This action needs a request identity. Refresh and try again.",
    });
  }
  const requestHash = hashMailPlacementRequest({
    actorUserId: context.userId,
    input,
    snooze,
  });
  if (snooze !== undefined && input.targets.length !== 1) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Choose one conversation for this snooze.",
    });
  }
  const requestCondition = and(
    eq(mailPlacementOperation.actorUserId, context.userId),
    eq(mailPlacementOperation.mailboxId, input.mailboxId),
    eq(mailPlacementOperation.requestId, requestId)
  );
  const readExistingRequest = async (database: Pick<typeof db, "select">) => {
    const existing = await database
      .select()
      .from(mailPlacementOperation)
      .where(requestCondition);
    if (existing.some((operation) => operation.requestHash !== requestHash)) {
      throw new ORPCError("CONFLICT", {
        message:
          "This action identity was already used for a different request.",
      });
    }
    return existing;
  };
  const workBudget = {
    key: `mail-placement:${context.userId}`,
    limit: 10_000,
    windowMs: 60 * 60_000,
  };
  let operations = await readExistingRequest(db);
  const ownedIds = new Set<string>();
  if (operations.length === 0) {
    const budget = chargeRateLimit
      ? await consumeRateLimit({
          ...workBudget,
          cost: input.targets.reduce(
            (total, target) => total + Math.max(1, target.messageIds.length),
            0
          ),
        })
      : {
          allowed: true as const,
          remaining: workBudget.limit,
          resetAt: new Date(),
        };
    if (budget.allowed) {
      const reserve = async (accessToken?: string) =>
        await db.transaction(async (tx) => {
          context.signal?.throwIfAborted();
          await tx
            .select({ id: mailbox.id })
            .from(mailbox)
            .where(eq(mailbox.id, input.mailboxId))
            .for("update");
          const existing = await readExistingRequest(tx);
          if (existing.length > 0) {
            return {
              committed: null,
              operations: existing,
              ownedIds: new Set<string>(),
            };
          }
          let currentSnooze: typeof mailSnooze.$inferSelect | undefined;
          const [onlyTarget] = input.targets;
          if (snooze !== undefined && onlyTarget !== undefined) {
            currentSnooze = await lockPlacementSnooze({
              database: tx,
              guard: snooze,
              mailboxId: input.mailboxId,
              requestId,
              threadId: onlyTarget.threadId,
              userId: context.userId,
            });
            if (snooze.kind === "snooze-return") {
              const [latest] = await tx
                .select()
                .from(mailPlacementOperation)
                .where(
                  and(
                    eq(mailPlacementOperation.mailboxId, input.mailboxId),
                    eq(mailPlacementOperation.threadId, onlyTarget.threadId)
                  )
                )
                .orderBy(desc(mailPlacementOperation.sequence))
                .limit(1);
              const predecessorId =
                currentSnooze.returnOperationId ??
                currentSnooze.hideOperationId;
              const duePredecessorValid =
                currentSnooze.returnAt.getTime() <= Date.now() &&
                currentSnooze.hideOperationId !== null &&
                ((currentSnooze.returnOperationId === null &&
                  latest?.id === currentSnooze.hideOperationId &&
                  latest.status === "applied") ||
                  (currentSnooze.returnOperationId !== null &&
                    latest?.id === currentSnooze.returnOperationId &&
                    latest.status === "failed"));
              if (
                (snooze.trigger === "due" && !duePredecessorValid) ||
                (snooze.trigger === "manual" &&
                  latest?.id !== (predecessorId ?? undefined))
              ) {
                throw new ORPCError("CONFLICT", {
                  message:
                    "A newer action changed this conversation. Refresh before trying again.",
                });
              }
            }
          }
          const anchorIds = [
            ...new Set(input.targets.flatMap((target) => target.messageIds)),
          ];
          const associations =
            prefetched?.associations ??
            (await loadMailPlacementAssociations({
              accessToken,
              context,
              database: tx,
              mailboxId: input.mailboxId,
              messageIds: anchorIds,
              provider: selected.provider,
            }));
          context.signal?.throwIfAborted();
          const threadIdsByMessageId = new Map(
            associations.map((message) => [message.id, message.threadId])
          );
          const admittedTargets = input.targets.filter(
            (target) =>
              target.messageIds.length > 0 &&
              target.messageIds.every(
                (id) => threadIdsByMessageId.get(id) === target.threadId
              )
          );
          let committed = null;
          if (admittedTargets.length === 0) {
            if (currentSnooze !== undefined && snooze !== undefined) {
              const retiredAt = new Date();
              await tx
                .update(mailSnooze)
                .set({
                  code: "source_changed",
                  leaseToken: null,
                  leaseUntil: null,
                  message:
                    "This conversation changed and is no longer snoozed.",
                  nextWakeAt: null,
                  status: "superseded",
                  updatedAt: retiredAt,
                  version: sql`${mailSnooze.version} + 1`,
                })
                .where(
                  and(
                    eq(mailSnooze.id, currentSnooze.id),
                    eq(mailSnooze.version, snooze.version),
                    snooze.leaseToken === null
                      ? isNull(mailSnooze.leaseToken)
                      : eq(mailSnooze.leaseToken, snooze.leaseToken)
                  )
                );
              committed = await appendSnoozeContentChange(tx, {
                mailboxId: input.mailboxId,
                provider: selected.provider,
                threadIds: [currentSnooze.threadId],
                updatedAt: retiredAt,
              });
            }
            return { committed, operations: [], ownedIds: new Set<string>() };
          }
          const now = new Date();
          if (snooze === undefined) {
            const retired = await tx
              .update(mailSnooze)
              .set({
                code: "newer_intent",
                leaseToken: null,
                leaseUntil: null,
                message: null,
                nextWakeAt: null,
                status: "superseded",
                updatedAt: now,
                version: sql`${mailSnooze.version} + 1`,
              })
              .where(
                and(
                  eq(mailSnooze.mailboxId, input.mailboxId),
                  inArray(
                    mailSnooze.threadId,
                    admittedTargets.map((target) => target.threadId)
                  ),
                  inArray(mailSnooze.status, MAIL_SNOOZE_LIVE_STATUSES)
                )
              )
              .returning({ threadId: mailSnooze.threadId });
            if (retired.length > 0) {
              committed = await appendSnoozeContentChange(tx, {
                mailboxId: input.mailboxId,
                provider: selected.provider,
                threadIds: retired.map(({ threadId }) => threadId),
                updatedAt: now,
              });
            }
          }
          const inserted = await tx
            .insert(mailPlacementOperation)
            .values(
              admittedTargets.map((target) => ({
                actorUserId: context.userId,
                createdAt: now,
                id: randomUUID(),
                mailboxId: input.mailboxId,
                messageIds: [],
                placement: input.command.placement,
                requestHash,
                requestId,
                requestedMessageIds: [...new Set(target.messageIds)].toSorted(),
                status: "pending" as const,
                threadId: target.threadId,
                updatedAt: now,
              }))
            )
            .returning();
          const [insertedOperation] = inserted;
          if (
            currentSnooze !== undefined &&
            snooze !== undefined &&
            insertedOperation !== undefined
          ) {
            await tx
              .update(mailSnooze)
              .set(
                snooze.kind === "snooze-hide"
                  ? { hideOperationId: insertedOperation.id, updatedAt: now }
                  : { returnOperationId: insertedOperation.id, updatedAt: now }
              )
              .where(
                and(
                  eq(mailSnooze.id, currentSnooze.id),
                  eq(mailSnooze.version, snooze.version)
                )
              );
          }
          return {
            committed,
            operations: inserted,
            ownedIds: new Set(inserted.map((operation) => operation.id)),
          };
        });
      const reserved =
        selected.provider === "gmail" && prefetched?.associations === undefined
          ? await callGmail(
              context,
              input.mailboxId,
              async (accessToken) => await reserve(accessToken)
            )
          : await reserve();
      await publishMailboxChange(reserved.committed);
      ({ operations } = reserved);
      for (const id of reserved.ownedIds) {
        ownedIds.add(id);
      }
    } else {
      operations = await readExistingRequest(db);
      if (operations.length === 0) {
        const retryAfter = Math.max(
          1,
          Math.ceil((budget.resetAt.getTime() - Date.now()) / 1000)
        );
        context.resHeaders?.set("retry-after", String(retryAfter));
        throw new ORPCError("RATE_LIMITED", {
          data: { provider: "server", retryAfter },
          message: "Too many conversations were changed. Try again later.",
          status: 429,
        });
      }
    }
  }
  const results: MailMutationTargetResult[] = [];
  const sourceBudget = { remaining: 1000 };
  for (const target of input.targets) {
    const operation = operations.find(
      (item) => item.threadId === target.threadId
    );
    if (operation === undefined) {
      results.push({
        code: "invalid_target",
        message:
          "This conversation changed or is no longer available. Refresh and try again.",
        replayed: operations.length > 0 && ownedIds.size === 0,
        status: "failed",
        threadId: target.threadId,
      });
      continue;
    }
    if (!ownedIds.has(operation.id)) {
      results.push(toPlacementResult(operation, true));
      continue;
    }
    let dispatched = false;
    try {
      context.signal?.throwIfAborted();
      const { messages, incomingMessageIds } =
        prefetched?.snapshot !== undefined && input.targets.length === 1
          ? prefetched.snapshot
          : await loadMailPlacementSnapshot({
              anchorCount: target.messageIds.length,
              budget: sourceBudget,
              chargeRateLimit,
              context,
              mailboxId: input.mailboxId,
              provider: selected.provider,
              threadId: target.threadId,
            });
      let messageIds: string[] | null;
      let currentSnooze: typeof mailSnooze.$inferSelect | undefined;
      // oxlint-disable-next-line unicorn/no-negated-condition -- Ordinary placement resolves a prefix, snooze restores its saved exact set.
      if (snooze === undefined) {
        messageIds = resolvePlacementMessageIds({
          messages,
          placement: input.command.placement,
          requestedMessageIds: target.messageIds,
          threadId: target.threadId,
        });
      } else {
        [currentSnooze] = await db
          .select()
          .from(mailSnooze)
          .where(
            and(
              eq(mailSnooze.id, snooze.id),
              eq(mailSnooze.mailboxId, input.mailboxId)
            )
          );
        if (
          currentSnooze === undefined ||
          currentSnooze.version !== snooze.version ||
          currentSnooze.leaseToken !== snooze.leaseToken ||
          currentSnooze.hiddenMessageIds.length === 0
        ) {
          throw new ORPCError("CONFLICT", {
            message: "This snooze changed. Refresh before trying again.",
          });
        }
        const hidden = new Set(currentSnooze.hiddenMessageIds);
        if (
          (snooze.kind === "snooze-hide" || snooze.trigger === "due") &&
          messages.some(
            (message) =>
              message.placement === "inbox" && !hidden.has(message.id)
          )
        ) {
          throw new ORPCError("SNOOZE_REOPENED", {
            message: "New mail arrived. This conversation is back in Inbox.",
            status: 409,
          });
        }
        if (
          currentSnooze.hiddenMessageIds.some(
            (id) =>
              !messages.some(
                (message) =>
                  message.id === id && message.placement !== "protected"
              )
          )
        ) {
          throw new ORPCError("SNOOZE_SOURCE_CHANGED", {
            message: "This conversation changed. Refresh before trying again.",
            status: 409,
          });
        }
        const sourcePlacement =
          snooze.kind === "snooze-hide" ? "inbox" : "done";
        messageIds = messages
          .filter(
            (message) =>
              hidden.has(message.id) && message.placement === sourcePlacement
          )
          .map((message) => message.id);
      }
      if (messageIds === null) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "This conversation changed or is no longer available. Refresh and try again.",
        });
      }
      const claimed = await db.transaction(async (tx) => {
        if (snooze !== undefined) {
          await tx
            .select({ id: mailbox.id })
            .from(mailbox)
            .where(eq(mailbox.id, input.mailboxId))
            .for("update");
          const registered = await lockPlacementSnooze({
            database: tx,
            guard: snooze,
            mailboxId: input.mailboxId,
            requestId,
            threadId: target.threadId,
            userId: context.userId,
          });
          if (snooze.kind === "snooze-hide") {
            await tx
              .update(mailSnooze)
              .set({
                hiddenMessageIds: registered.hiddenMessageIds,
                knownIncomingMessageIds: incomingMessageIds,
                updatedAt: new Date(),
              })
              .where(eq(mailSnooze.id, registered.id));
          }
        }
        const [row] = await tx
          .update(mailPlacementOperation)
          .set({ messageIds, status: "submitting", updatedAt: new Date() })
          .where(
            and(
              eq(mailPlacementOperation.id, operation.id),
              eq(mailPlacementOperation.status, "pending")
            )
          )
          .returning();
        return row;
      });
      if (claimed === undefined) {
        results.push({
          code: "newer_intent",
          message:
            "A newer action changed this conversation. Refresh to see its current state.",
          operationId: operation.id,
          status: "failed",
          threadId: target.threadId,
        });
        continue;
      }
      const commit = async (accessToken?: string) =>
        await db.transaction(async (tx) => {
          context.signal?.throwIfAborted();
          const lockedMessages =
            selected.provider === "managed" && messageIds.length > 0
              ? await tx
                  .select({
                    id: managedMailMessage.id,
                    mailboxState: managedMailMessage.mailboxState,
                  })
                  .from(managedMailMessage)
                  .where(
                    and(
                      eq(managedMailMessage.mailboxId, input.mailboxId),
                      eq(managedMailMessage.threadId, target.threadId),
                      eq(managedMailMessage.direction, "inbound"),
                      inArray(managedMailMessage.id, messageIds)
                    )
                  )
                  .orderBy(asc(managedMailMessage.id))
                  .for("update")
              : [];
          await tx
            .select({ id: mailbox.id })
            .from(mailbox)
            .where(eq(mailbox.id, input.mailboxId))
            .for("update");
          const registeredSnooze = snooze
            ? await lockPlacementSnooze({
                database: tx,
                guard: snooze,
                mailboxId: input.mailboxId,
                requestId,
                threadId: target.threadId,
                userId: context.userId,
              })
            : undefined;
          const [locked] = await tx
            .select()
            .from(mailPlacementOperation)
            .where(eq(mailPlacementOperation.id, operation.id))
            .for("update");
          const [latest] = await tx
            .select({ sequence: mailPlacementOperation.sequence })
            .from(mailPlacementOperation)
            .where(
              and(
                eq(mailPlacementOperation.mailboxId, input.mailboxId),
                eq(mailPlacementOperation.threadId, target.threadId)
              )
            )
            .orderBy(desc(mailPlacementOperation.sequence))
            .limit(1);
          context.signal?.throwIfAborted();
          if (locked === undefined) {
            throw new ORPCError("NOT_FOUND");
          }
          if (
            locked.status !== "submitting" ||
            latest?.sequence !== locked.sequence
          ) {
            const [superseded] = await tx
              .update(mailPlacementOperation)
              .set({
                code: "newer_intent",
                message:
                  "A newer action changed this conversation. Refresh to see its current state.",
                status: "superseded",
                updatedAt: new Date(),
              })
              .where(eq(mailPlacementOperation.id, operation.id))
              .returning();
            return {
              committed: null,
              result: toPlacementResult(superseded ?? locked, false),
            };
          }
          if (selected.provider === "managed" && messageIds.length > 0) {
            const sourceState =
              input.command.placement === "done" ? "active" : "done";
            if (
              lockedMessages.length !== messageIds.length ||
              lockedMessages.some(
                (record) => record.mailboxState !== sourceState
              )
            ) {
              throw new ORPCError("CONFLICT", {
                message:
                  "This conversation changed. Refresh before trying again.",
              });
            }
            await tx
              .update(managedMailMessage)
              .set({
                mailboxState:
                  input.command.placement === "done" ? "done" : "active",
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(managedMailMessage.mailboxId, input.mailboxId),
                  inArray(managedMailMessage.id, messageIds)
                )
              );
          } else if (selected.provider === "gmail" && messageIds.length > 0) {
            if (accessToken === undefined) {
              throw new Error(
                "Placement dispatch requires an authorized mailbox token."
              );
            }
            dispatched = true;
            await batchModifyMessages(
              accessToken,
              messageIds,
              input.command.placement === "done"
                ? { removeLabelIds: ["INBOX"] }
                : { addLabelIds: ["INBOX"] },
              context.signal
            );
          }
          const [completed] = await tx
            .update(mailPlacementOperation)
            .set({
              code: null,
              message: null,
              status: "applied",
              updatedAt: new Date(),
            })
            .where(eq(mailPlacementOperation.id, operation.id))
            .returning();
          if (registeredSnooze !== undefined && snooze) {
            await tx
              .update(mailSnooze)
              .set({
                ...(snooze.kind === "snooze-hide" ? { attempts: 0 } : {}),
                code: null,
                leaseToken: null,
                leaseUntil: null,
                message: null,
                nextWakeAt: snooze.kind === "snooze-hide" ? new Date() : null,
                status: snooze.kind === "snooze-hide" ? "active" : "returned",
                updatedAt: new Date(),
                version: registeredSnooze.version + 1,
              })
              .where(
                and(
                  eq(mailSnooze.id, registeredSnooze.id),
                  eq(mailSnooze.version, snooze.version),
                  snooze.leaseToken === null
                    ? isNull(mailSnooze.leaseToken)
                    : eq(mailSnooze.leaseToken, snooze.leaseToken)
                )
              );
            if (selected.provider !== "managed") {
              await appendSnoozeContentChange(tx, {
                mailboxId: input.mailboxId,
                provider: selected.provider,
                threadIds: [target.threadId],
              });
            }
          }
          const committed =
            selected.provider === "managed" &&
            (messageIds.length > 0 || registeredSnooze !== undefined)
              ? await appendManagedMailboxContentChange(tx, {
                  changes:
                    messageIds.length > 0
                      ? messageIds.map((messageId) => ({
                          kind: "message.labels",
                          messageId,
                          threadId: target.threadId,
                        }))
                      : [
                          {
                            kind: "capture.changed",
                            threadId: target.threadId,
                          },
                        ],
                  mailboxId: input.mailboxId,
                })
              : null;
          return {
            committed,
            result: toPlacementResult(completed ?? locked, false),
          };
        });
      if (selected.provider === "managed") {
        await authorizeMailPlacement(context, input.mailboxId);
      }
      const { committed, result } =
        selected.provider === "gmail"
          ? await callGmail(
              context,
              input.mailboxId,
              async (accessToken, signal) => {
                for (let offset = 0; offset < messageIds.length; offset += 4) {
                  signal?.throwIfAborted();
                  const metadata = await Promise.all(
                    messageIds
                      .slice(offset, offset + 4)
                      .map(
                        async (messageId) =>
                          await getGmailCaptureMetadata(
                            accessToken,
                            messageId,
                            signal
                          )
                      )
                  );
                  if (
                    metadata.some(
                      (message) =>
                        message.labelIds.some((label) =>
                          ["SENT", "DRAFT", "SPAM", "TRASH"].includes(label)
                        ) ||
                        message.labelIds.includes("INBOX") !==
                          (input.command.placement === "done")
                    )
                  ) {
                    throw new ORPCError("CONFLICT", {
                      message:
                        "This conversation changed. Refresh before trying again.",
                    });
                  }
                }
                signal?.throwIfAborted();
                return await commit(accessToken);
              }
            )
          : await commit();
      await publishMailboxChange(committed);
      results.push(result);
      if (
        selected.provider === "gmail" &&
        result.status === "applied" &&
        messageIds.length > 0
      ) {
        await callGmail(context, input.mailboxId, async (accessToken) => {
          await refreshGmailCapturedMessageMetadata({
            accessToken,
            mailboxId: input.mailboxId,
            messageIds,
            signal: context.signal,
          });
        }).catch((error: unknown) => {
          if (context.signal?.aborted !== true) {
            reportError(error, { operation: "placement-refresh-metadata" });
          }
        });
      }
    } catch (error) {
      const oversized = isGmailServiceError(error) && error.status === 413;
      if (oversized) {
        sourceBudget.remaining = 0;
      }
      const placementError = oversized
        ? new ORPCError("BAD_REQUEST", {
            message:
              "This action includes too much conversation history. Choose fewer conversations and try again.",
          })
        : error;
      if (
        (!(placementError instanceof ORPCError) ||
          typeof placementError.code !== "string" ||
          ![
            "BAD_REQUEST",
            "CONFLICT",
            "FORBIDDEN",
            "NOT_FOUND",
            "RATE_LIMITED",
            "UNAUTHORIZED",
            "SNOOZE_REOPENED",
            "SNOOZE_SOURCE_CHANGED",
          ].includes(placementError.code)) &&
        !(
          placementError instanceof Error &&
          placementError.name === "AbortError"
        ) &&
        context.signal?.aborted !== true
      ) {
        reportError(placementError, { operation: "mail-placement" });
      }
      let failure = {
        code: "placement_failed",
        message:
          "This conversation could not be updated. Refresh and try again.",
      };
      if (dispatched) {
        failure = {
          code: "placement_uncertain",
          message:
            "This conversation may have changed. Refresh before trying again.",
        };
      } else if (
        placementError instanceof ORPCError &&
        typeof placementError.code === "string"
      ) {
        failure = {
          code: placementError.code,
          message: placementError.message,
        };
      }
      const [failed] = await db
        .update(mailPlacementOperation)
        .set({
          ...failure,
          status: dispatched ? "uncertain" : "failed",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mailPlacementOperation.id, operation.id),
            inArray(mailPlacementOperation.status, ["pending", "submitting"])
          )
        )
        .returning();
      if (snooze !== undefined) {
        if (snooze.leaseToken !== null && !dispatched) {
          const isTerminalSnoozeError =
            (placementError instanceof ORPCError &&
              typeof placementError.code === "string" &&
              [
                "BAD_REQUEST",
                "CONFLICT",
                "SNOOZE_REOPENED",
                "SNOOZE_SOURCE_CHANGED",
              ].includes(placementError.code)) ||
            (isGmailServiceError(placementError) &&
              (placementError.status === 400 || placementError.status === 404));
          if (!isTerminalSnoozeError) {
            throw placementError;
          }
        }
        const committed = await db.transaction(async (tx) => {
          await tx
            .select({ id: mailbox.id })
            .from(mailbox)
            .where(eq(mailbox.id, input.mailboxId))
            .for("update");
          let status: "superseded" | "uncertain" | "failed" = dispatched
            ? "uncertain"
            : "failed";
          if (
            failure.code === "SNOOZE_REOPENED" ||
            failure.code === "SNOOZE_SOURCE_CHANGED"
          ) {
            status = "superseded";
          }
          const changed = await tx
            .update(mailSnooze)
            .set({
              ...failure,
              leaseToken: null,
              leaseUntil: null,
              nextWakeAt:
                status === "uncertain" ? new Date(Date.now() + 60_000) : null,
              status,
              updatedAt: new Date(),
              version: sql`${mailSnooze.version} + 1`,
            })
            .where(
              and(
                eq(mailSnooze.id, snooze.id),
                eq(mailSnooze.mailboxId, input.mailboxId),
                eq(mailSnooze.version, snooze.version),
                snooze.leaseToken === null
                  ? isNull(mailSnooze.leaseToken)
                  : eq(mailSnooze.leaseToken, snooze.leaseToken)
              )
            )
            .returning({ id: mailSnooze.id });
          const change =
            changed.length > 0
              ? await appendSnoozeContentChange(tx, {
                  mailboxId: input.mailboxId,
                  provider: selected.provider,
                  threadIds: [target.threadId],
                })
              : undefined;
          return change ?? undefined;
        });
        await publishMailboxChange(committed);
      }
      results.push(
        failed === undefined
          ? {
              code: "newer_intent",
              operationId: operation.id,
              status: "failed",
              threadId: target.threadId,
            }
          : toPlacementResult(failed, false)
      );
    }
  }
  return { targets: results };
};
