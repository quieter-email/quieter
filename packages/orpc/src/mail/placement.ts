import { createHash, randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  mailbox,
  mailPlacementOperation,
  managedMailMessage,
} from "@quieter/database/schema";
import {
  batchModifyMessages,
  getGmailCaptureMetadata,
  getGmailMessageThreadAssociations,
  getGmailThreadMessageCount,
  getThreadWithDetails,
  isGmailServiceError,
} from "@quieter/gmail";
import type {
  MailMutationResult,
  MailMutationTargetResult,
} from "@quieter/mail/data-plane";
import { reportError } from "@quieter/observability";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { consumeRateLimit } from "../abuse-protection";
import type { PreparedGmailMailboxIdentity } from "../gmail-mailbox-access";
import { assertMailEffectAllowed, callGmail } from "../gmail-request";
import type { MailRequestContext } from "../gmail-request";
import {
  refreshGmailCapturedMessageMetadata,
  writeGmailCapturedMessage,
} from "../mail-capture";
import { getAuthorizedManagedMailbox } from "../mailbox/access";
import { assertAccessibleMailbox } from "../mailbox/service";
import type { MailInputs } from "./inputs";
import { resolvePlacementMessageIds } from "./placement-model";
import type { PlacementMessage } from "./placement-model";

type PreparedPlacementGmail = {
  accessToken: string;
  gmailIdentity: PreparedGmailMailboxIdentity;
};

const authorizePlacement = async (
  context: MailRequestContext,
  mailboxId: string
) => {
  const selected = await assertAccessibleMailbox({
    mailboxId,
    userId: context.userId,
  });
  if (selected.provider === "managed") {
    await getAuthorizedManagedMailbox({
      mailboxId,
      requiredRoles: ["manager", "responder"],
      userId: context.userId,
    });
  } else if (selected.provider !== "gmail") {
    throw new ORPCError("FORBIDDEN", {
      message: "You cannot change placement in this inbox.",
    });
  }
  return selected;
};

export const supersedePendingMailPlacement = async (input: {
  context: MailRequestContext;
  mailboxId: string;
  messageId?: string;
  threadIds?: string[];
}) => {
  await authorizePlacement(input.context, input.mailboxId);
  const targetCondition =
    input.messageId === undefined
      ? inArray(mailPlacementOperation.threadId, input.threadIds ?? [])
      : sql`(${mailPlacementOperation.messageIds} @> ${JSON.stringify([input.messageId])}::jsonb or ${mailPlacementOperation.requestedMessageIds} @> ${JSON.stringify([input.messageId])}::jsonb)`;
  await db.transaction(async (tx) => {
    await assertMailEffectAllowed(input.context, input.mailboxId, tx, {
      providerWrite: false,
    });
    await tx
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
      );
  });
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

export const applyMailPlacement = async ({
  context: requestContext,
  input,
}: {
  context: MailRequestContext;
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
  const selected = await authorizePlacement(context, input.mailboxId);
  const { requestId } = input;
  if (requestId === undefined) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This action needs a request identity. Refresh and try again.",
    });
  }
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        actorUserId: context.userId,
        command: input.command,
        mailboxId: input.mailboxId,
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
    const budget = await consumeRateLimit({
      ...workBudget,
      cost: input.targets.reduce(
        (total, target) => total + Math.max(1, target.messageIds.length),
        0
      ),
    });
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
            return { operations: existing, ownedIds: new Set<string>() };
          }
          const anchorIds = [
            ...new Set(input.targets.flatMap((target) => target.messageIds)),
          ];
          let associations: { id: string; threadId: string }[];
          if (selected.provider === "managed") {
            associations = await tx
              .select({
                id: managedMailMessage.id,
                threadId: managedMailMessage.threadId,
              })
              .from(managedMailMessage)
              .where(
                and(
                  eq(managedMailMessage.mailboxId, input.mailboxId),
                  inArray(managedMailMessage.id, anchorIds)
                )
              );
          } else {
            if (accessToken === undefined) {
              throw new Error(
                "Placement admission requires an authorized mailbox token."
              );
            }
            const timeout = AbortSignal.timeout(15_000);
            const signal = context.signal
              ? AbortSignal.any([context.signal, timeout])
              : timeout;
            associations = await getGmailMessageThreadAssociations(
              accessToken,
              anchorIds,
              signal
            );
            signal.throwIfAborted();
          }
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
          if (admittedTargets.length === 0) {
            return { operations: [], ownedIds: new Set<string>() };
          }
          const now = new Date();
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
          return {
            operations: inserted,
            ownedIds: new Set(inserted.map((operation) => operation.id)),
          };
        });
      const reserved =
        selected.provider === "gmail"
          ? await callGmail(
              context,
              input.mailboxId,
              async (accessToken) => await reserve(accessToken)
            )
          : await reserve();
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
  let remainingSourceMessages = 1000;
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
      if (remainingSourceMessages === 0) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "This action includes too much conversation history. Choose fewer conversations and try again.",
        });
      }
      let source:
        | { kind: "managed"; messages: PlacementMessage[] }
        | { kind: "gmail"; messageCount: number };
      if (selected.provider === "managed") {
        const records = await db
          .select({
            createdAt: managedMailMessage.createdAt,
            direction: managedMailMessage.direction,
            id: managedMailMessage.id,
            mailboxState: managedMailMessage.mailboxState,
            threadId: managedMailMessage.threadId,
          })
          .from(managedMailMessage)
          .where(
            and(
              eq(managedMailMessage.mailboxId, input.mailboxId),
              eq(managedMailMessage.threadId, target.threadId)
            )
          )
          .orderBy(
            asc(managedMailMessage.createdAt),
            asc(managedMailMessage.id)
          )
          .limit(remainingSourceMessages + 1);
        source = {
          kind: "managed",
          messages: records.map((message): PlacementMessage => {
            let placement: PlacementMessage["placement"] = "protected";
            if (message.direction === "inbound") {
              if (message.mailboxState === "active") {
                placement = "inbox";
              } else if (message.mailboxState === "done") {
                placement = "done";
              }
            }
            return {
              id: message.id,
              placement,
              receivedAt: message.createdAt.getTime(),
              threadId: message.threadId,
            };
          }),
        };
      } else {
        source = {
          kind: "gmail",
          messageCount: await callGmail(
            context,
            input.mailboxId,
            async (accessToken, signal) =>
              await getGmailThreadMessageCount(
                accessToken,
                target.threadId,
                signal
              )
          ),
        };
      }
      const sourceMessageCount =
        source.kind === "managed"
          ? source.messages.length
          : source.messageCount;
      const additionalCost = Math.max(
        0,
        sourceMessageCount - target.messageIds.length
      );
      if (additionalCost > 0) {
        const expandedBudget = await consumeRateLimit({
          ...workBudget,
          cost: additionalCost,
        });
        if (!expandedBudget.allowed) {
          remainingSourceMessages = 0;
          const retryAfter = Math.max(
            1,
            Math.ceil((expandedBudget.resetAt.getTime() - Date.now()) / 1000)
          );
          context.resHeaders?.set("retry-after", String(retryAfter));
          throw new ORPCError("RATE_LIMITED", {
            data: { provider: "server", retryAfter },
            message: "Too many conversations were changed. Try again later.",
            status: 429,
          });
        }
      }
      if (sourceMessageCount > remainingSourceMessages) {
        remainingSourceMessages = 0;
        throw new ORPCError("BAD_REQUEST", {
          message:
            "This action includes too much conversation history. Choose fewer conversations and try again.",
        });
      }
      remainingSourceMessages -= sourceMessageCount;
      let messages: PlacementMessage[];
      if (source.kind === "gmail") {
        const thread = await callGmail(
          context,
          input.mailboxId,
          async (accessToken, signal) =>
            await getThreadWithDetails(
              accessToken,
              target.threadId,
              signal,
              async (snapshot) => {
                signal?.throwIfAborted();
                await writeGmailCapturedMessage({
                  mailboxId: input.mailboxId,
                  snapshot,
                  source: "on_demand",
                });
              },
              sourceMessageCount
            )
        );
        messages = thread.messages.map((message): PlacementMessage => {
          let placement: PlacementMessage["placement"] = "done";
          if (
            message.labelIds?.some((label) =>
              ["SENT", "DRAFT", "SPAM", "TRASH"].includes(label)
            ) === true
          ) {
            placement = "protected";
          } else if (message.labelIds?.includes("INBOX") === true) {
            placement = "inbox";
          }
          return {
            id: message.id,
            placement,
            receivedAt: Number(message.internalDate ?? 0),
            threadId: message.threadId,
          };
        });
      } else {
        ({ messages } = source);
      }
      const messageIds = resolvePlacementMessageIds({
        messages,
        placement: input.command.placement,
        requestedMessageIds: target.messageIds,
        threadId: target.threadId,
      });
      if (messageIds === null) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "This conversation changed or is no longer available. Refresh and try again.",
        });
      }
      const [claimed] = await db
        .update(mailPlacementOperation)
        .set({ messageIds, status: "submitting", updatedAt: new Date() })
        .where(
          and(
            eq(mailPlacementOperation.id, operation.id),
            eq(mailPlacementOperation.status, "pending")
          )
        )
        .returning();
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
      const commit = async (preparedGmail?: PreparedPlacementGmail) =>
        await db.transaction(async (tx) => {
          context.signal?.throwIfAborted();
          const effectContext =
            preparedGmail === undefined
              ? context
              : { ...context, gmailIdentity: preparedGmail.gmailIdentity };
          await assertMailEffectAllowed(effectContext, input.mailboxId, tx);
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
            return toPlacementResult(superseded ?? locked, false);
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
            await tx
              .update(mailbox)
              .set({
                contentRevision: sql`${mailbox.contentRevision} + 1`,
                updatedAt: new Date(),
              })
              .where(eq(mailbox.id, input.mailboxId));
          } else if (selected.provider === "gmail" && messageIds.length > 0) {
            if (preparedGmail === undefined) {
              throw new Error(
                "Placement dispatch requires an authorized mailbox token."
              );
            }
            await batchModifyMessages(
              preparedGmail.accessToken,
              messageIds,
              input.command.placement === "done"
                ? { removeLabelIds: ["INBOX"] }
                : { addLabelIds: ["INBOX"] },
              context.signal,
              async () => {
                await assertMailEffectAllowed(
                  effectContext,
                  input.mailboxId,
                  tx
                );
                dispatched = true;
              }
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
          return toPlacementResult(completed ?? locked, false);
        });
      if (selected.provider === "managed") {
        await authorizePlacement(context, input.mailboxId);
      }
      const result =
        selected.provider === "gmail"
          ? await callGmail(
              context,
              input.mailboxId,
              async (accessToken, signal, _beforeEffect, gmailIdentity) => {
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
                return await commit({ accessToken, gmailIdentity });
              }
            )
          : await commit();
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
        remainingSourceMessages = 0;
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
