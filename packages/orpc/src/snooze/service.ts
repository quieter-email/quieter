import { createHash, randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  gmailCapturedMessage,
  mailbox,
  mailPlacementOperation,
  mailSnooze,
  mailSnoozeOperation,
  managedMailMessage,
} from "@quieter/database/schema";
import type {
  MailSnoozeApplyInput,
  MailSnoozeResult,
  MailSnoozeTargetResult,
} from "@quieter/mail/snooze";
import type { MailSnoozeScope } from "@quieter/mail/snooze-ticket";
import { reportError } from "@quieter/observability";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  notExists,
  sql,
} from "drizzle-orm";

import { consumeRateLimit } from "../abuse-protection";
import { callGmail } from "../gmail-request";
import type { MailRequestContext } from "../gmail-request";
import { publishMailUpdate } from "../mail-updates";
import { applyMailPlacement } from "../mail/placement";
import { authorizeMailPlacement } from "../mail/placement-access";
import {
  loadMailPlacementAssociations,
  loadMailPlacementSnapshot,
} from "../mail/placement-admission";
import { resolvePlacementMessageIds } from "../mail/placement-model";
import { MAIL_SNOOZE_LIVE_STATUSES, serializeMailSnoozeState } from "./state";
import { requestMailSnoozeWake } from "./wake";

const finishSnoozeFailure = async (input: {
  id: string;
  mailboxId: string;
  version: number;
  leaseToken: string | null;
  code: string;
  message: string;
  status: "failed" | "suspended" | "superseded" | "uncertain";
}) =>
  await db.transaction(async (tx) => {
    await tx
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(eq(mailbox.id, input.mailboxId))
      .for("update");
    const changed = await tx
      .update(mailSnooze)
      .set({
        code: input.code,
        leaseToken: null,
        leaseUntil: null,
        message: input.message,
        nextWakeAt:
          input.status === "uncertain" ? new Date(Date.now() + 60_000) : null,
        status: input.status,
        updatedAt: new Date(),
        version: input.version + 1,
      })
      .where(
        and(
          eq(mailSnooze.id, input.id),
          eq(mailSnooze.mailboxId, input.mailboxId),
          eq(mailSnooze.version, input.version),
          input.leaseToken === null
            ? isNull(mailSnooze.leaseToken)
            : eq(mailSnooze.leaseToken, input.leaseToken)
        )
      )
      .returning({ id: mailSnooze.id });
    if (changed.length > 0) {
      await tx
        .update(mailbox)
        .set({
          contentRevision: sql`${mailbox.contentRevision} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(mailbox.id, input.mailboxId));
    }
    return changed.length > 0;
  });

const describeSnoozeFailure = (error: unknown) => {
  if (error instanceof ORPCError && typeof error.code === "string") {
    return { code: error.code, message: error.message };
  }
  if (!(error instanceof Error && error.name === "AbortError")) {
    reportError(error, { operation: "mail-snooze" });
  }
  return {
    code: "snooze_failed",
    message: "This conversation could not be snoozed. Refresh and try again.",
  };
};

const inspectSnoozeSource = async (input: {
  context: MailRequestContext;
  row: typeof mailSnooze.$inferSelect;
  provider: string;
}) => {
  const source = await loadMailPlacementSnapshot({
    anchorCount: 0,
    budget: { remaining: 1000 },
    context: input.context,
    mailboxId: input.row.mailboxId,
    provider: input.provider,
    threadId: input.row.threadId,
  });
  const hidden = new Set(input.row.hiddenMessageIds);
  return {
    ...source,
    done: input.row.hiddenMessageIds.every((id) =>
      source.messages.some(
        (message) => message.id === id && message.placement === "done"
      )
    ),
    inbox: input.row.hiddenMessageIds.every((id) =>
      source.messages.some(
        (message) => message.id === id && message.placement === "inbox"
      )
    ),
    protected: input.row.hiddenMessageIds.some(
      (id) =>
        !source.messages.some(
          (message) => message.id === id && message.placement !== "protected"
        )
    ),
    reopened: source.messages.some(
      (message) => message.placement === "inbox" && !hidden.has(message.id)
    ),
  };
};

const replaySnoozeOperations = async (input: {
  operations: (typeof mailSnoozeOperation.$inferSelect)[];
  targets: MailSnoozeApplyInput["targets"];
  mailboxId: string;
}): Promise<MailSnoozeResult> => {
  const schedules = await db
    .select()
    .from(mailSnooze)
    .where(
      and(
        eq(mailSnooze.mailboxId, input.mailboxId),
        inArray(
          mailSnooze.threadId,
          input.targets.map((target) => target.threadId)
        )
      )
    );
  return {
    targets: input.targets.map((target): MailSnoozeTargetResult => {
      const operation = input.operations.find(
        (item) => item.threadId === target.threadId
      );
      const schedule = schedules.find(
        (item) => item.threadId === target.threadId
      );
      return {
        code:
          operation?.status === "applied"
            ? undefined
            : (operation?.code ?? "snooze_unconfirmed"),
        message:
          operation?.status === "applied"
            ? undefined
            : (operation?.message ??
              "This action is still being confirmed. Refresh before trying again."),
        operationId: operation?.id,
        replayed: true,
        snooze:
          schedule === undefined
            ? undefined
            : serializeMailSnoozeState(schedule),
        status: operation?.status === "applied" ? "applied" : "failed",
        threadId: target.threadId,
      };
    }),
  };
};

export const applyMailSnooze = async ({
  context: requestContext,
  input,
}: {
  context: MailRequestContext;
  input: MailSnoozeApplyInput;
}): Promise<MailSnoozeResult> => {
  const deadline = AbortSignal.timeout(30_000);
  const context: MailRequestContext = {
    ...requestContext,
    signal: requestContext.signal
      ? AbortSignal.any([requestContext.signal, deadline])
      : deadline,
  };
  const selected = await authorizeMailPlacement(context, input.mailboxId);
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        actorUserId: context.userId,
        command: input.command,
        mailboxId: input.mailboxId,
        targets: input.targets
          .map((target) => ({
            ...target,
            messageIds: [...new Set(target.messageIds)].toSorted(),
          }))
          .toSorted((left, right) =>
            left.threadId.localeCompare(right.threadId)
          ),
      })
    )
    .digest("hex");
  const requestCondition = and(
    eq(mailSnoozeOperation.actorUserId, context.userId),
    eq(mailSnoozeOperation.mailboxId, input.mailboxId),
    eq(mailSnoozeOperation.requestId, input.requestId)
  );
  const readExisting = async (database: Pick<typeof db, "select">) => {
    const operations = await database
      .select()
      .from(mailSnoozeOperation)
      .where(requestCondition);
    if (operations.some((operation) => operation.requestHash !== requestHash)) {
      throw new ORPCError("CONFLICT", {
        message:
          "This action identity was already used for a different request.",
      });
    }
    return operations;
  };
  const existing = await readExisting(db);
  if (existing.length > 0) {
    return await replaySnoozeOperations({
      mailboxId: input.mailboxId,
      operations: existing,
      targets: input.targets,
    });
  }
  if (
    (input.command.kind === "snooze" || input.command.kind === "reschedule") &&
    new Date(input.command.returnAt).getTime() <= Date.now()
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Choose a future time for this snooze.",
    });
  }
  const admission = await consumeRateLimit({
    cost: input.targets.reduce(
      (sum, target) => sum + Math.max(1, target.messageIds.length),
      0
    ),
    key: `mail-placement:${context.userId}`,
    limit: 10_000,
    windowMs: 60 * 60_000,
  });
  if (!admission.allowed) {
    const won = await readExisting(db);
    if (won.length > 0) {
      return await replaySnoozeOperations({
        mailboxId: input.mailboxId,
        operations: won,
        targets: input.targets,
      });
    }
    throw new ORPCError("RATE_LIMITED", {
      data: {
        provider: "server",
        retryAfter: Math.max(
          1,
          Math.ceil((admission.resetAt.getTime() - Date.now()) / 1000)
        ),
      },
      message: "Too many conversations were changed. Try again later.",
      status: 429,
    });
  }
  const prepared = new Map<
    string,
    { hiddenMessageIds: string[]; knownIncomingMessageIds: string[] }
  >();
  const rejected = new Map<string, { code: string; message: string }>();
  const sourceBudget = { remaining: 1000 };
  if (input.command.kind === "snooze") {
    const anchorIds = [
      ...new Set(input.targets.flatMap((target) => target.messageIds)),
    ];
    const associations =
      selected.provider === "managed"
        ? await loadMailPlacementAssociations({
            context,
            database: db,
            mailboxId: input.mailboxId,
            messageIds: anchorIds,
            provider: selected.provider,
          })
        : await callGmail(
            context,
            input.mailboxId,
            async (accessToken) =>
              await loadMailPlacementAssociations({
                accessToken,
                context,
                database: db,
                mailboxId: input.mailboxId,
                messageIds: anchorIds,
                provider: selected.provider,
              })
          );
    const threads = new Map(
      associations.map((association) => [association.id, association.threadId])
    );
    for (const target of input.targets) {
      try {
        if (
          !target.messageIds.every((id) => threads.get(id) === target.threadId)
        ) {
          throw new ORPCError("BAD_REQUEST", {
            message:
              "This conversation changed or is no longer available. Refresh and try again.",
          });
        }
        const snapshot = await loadMailPlacementSnapshot({
          anchorCount: target.messageIds.length,
          budget: sourceBudget,
          context,
          mailboxId: input.mailboxId,
          provider: selected.provider,
          threadId: target.threadId,
        });
        const hidden = resolvePlacementMessageIds({
          messages: snapshot.messages,
          placement: "done",
          requestedMessageIds: target.messageIds,
          threadId: target.threadId,
        });
        if (hidden === null || hidden.length === 0) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Choose mail in Inbox to snooze.",
          });
        }
        if (
          snapshot.messages.some(
            (message) =>
              message.placement === "inbox" && !hidden.includes(message.id)
          )
        ) {
          throw new ORPCError("CONFLICT", {
            message:
              "New mail arrived. Refresh this conversation before snoozing.",
          });
        }
        prepared.set(target.threadId, {
          hiddenMessageIds: hidden,
          knownIncomingMessageIds: snapshot.incomingMessageIds,
        });
      } catch (error) {
        rejected.set(target.threadId, describeSnoozeFailure(error));
      }
    }
  }
  const reservation = await db.transaction(async (tx) => {
    await tx
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(eq(mailbox.id, input.mailboxId))
      .for("update");
    const won = await readExisting(tx);
    if (won.length > 0) {
      return { operations: won, ownedIds: new Set<string>() };
    }
    const operations: (typeof mailSnoozeOperation.$inferSelect)[] = [];
    for (const target of input.targets) {
      if (rejected.has(target.threadId)) {
        continue;
      }
      const [current] = await tx
        .select()
        .from(mailSnooze)
        .where(
          and(
            eq(mailSnooze.mailboxId, input.mailboxId),
            eq(mailSnooze.threadId, target.threadId)
          )
        )
        .for("update");
      if ((current?.version ?? null) !== target.expectedVersion) {
        rejected.set(target.threadId, {
          code: "CONFLICT",
          message: "This snooze changed. Refresh before trying again.",
        });
        continue;
      }
      const now = new Date();
      let saved: typeof mailSnooze.$inferSelect | undefined;
      if (input.command.kind === "snooze") {
        const snapshot = prepared.get(target.threadId);
        if (!snapshot) {
          continue;
        }
        if (
          current !== undefined &&
          [
            "preparing",
            "active",
            "returning",
            "suspended",
            "uncertain",
          ].includes(current.status)
        ) {
          rejected.set(target.threadId, {
            code: "CONFLICT",
            message:
              "This conversation is already snoozed. Reschedule it instead.",
          });
          continue;
        }
        const values = {
          actorUserId: context.userId,
          attempts: 0,
          code: null,
          createdAt: current?.createdAt ?? now,
          hiddenMessageIds: snapshot.hiddenMessageIds,
          hideOperationId: null,
          hideRequestId: randomUUID(),
          id: current?.id ?? randomUUID(),
          knownIncomingMessageIds: snapshot.knownIncomingMessageIds,
          leaseToken: null,
          leaseUntil: null,
          mailboxId: input.mailboxId,
          message: null,
          nextWakeAt: now,
          returnAt: new Date(input.command.returnAt),
          returnOperationId: null,
          returnRequestId: null,
          status: "preparing" as const,
          threadId: target.threadId,
          timeZone: input.command.timeZone,
          updatedAt: now,
          version: (current?.version ?? 0) + 1,
        };
        [saved] =
          current === undefined
            ? await tx.insert(mailSnooze).values(values).returning()
            : await tx
                .update(mailSnooze)
                .set(values)
                .where(eq(mailSnooze.id, current.id))
                .returning();
        if (saved === undefined) {
          throw new ORPCError("INTERNAL_SERVER_ERROR");
        }
      } else {
        if (
          current === undefined ||
          !MAIL_SNOOZE_LIVE_STATUSES.some((status) => status === current.status)
        ) {
          rejected.set(target.threadId, {
            code: "CONFLICT",
            message:
              "This snooze has already ended. Refresh this conversation.",
          });
          continue;
        }
        if (input.command.kind === "reschedule") {
          const [latest] = await tx
            .select()
            .from(mailPlacementOperation)
            .where(
              and(
                eq(mailPlacementOperation.mailboxId, input.mailboxId),
                eq(mailPlacementOperation.threadId, target.threadId)
              )
            )
            .orderBy(desc(mailPlacementOperation.sequence))
            .limit(1);
          if (
            !["active", "suspended"].includes(current.status) ||
            latest?.id !== current.hideOperationId ||
            latest?.status !== "applied" ||
            current.hiddenMessageIds.length === 0
          ) {
            rejected.set(target.threadId, {
              code: "CONFLICT",
              message:
                "Confirm this conversation's current state before rescheduling.",
            });
            continue;
          }
        }
        if (
          (input.command.kind === "return-now" &&
            current.hiddenMessageIds.length === 0) ||
          (input.command.kind === "cancel" && current.status === "returning")
        ) {
          rejected.set(target.threadId, {
            code: "CONFLICT",
            message:
              "This return is still being confirmed. Refresh before trying again.",
          });
          continue;
        }
        let values: Partial<typeof mailSnooze.$inferInsert>;
        if (input.command.kind === "reschedule") {
          values = {
            actorUserId: context.userId,
            nextWakeAt: now,
            returnAt: new Date(input.command.returnAt),
            returnOperationId: null,
            returnRequestId: null,
            status: "active",
            timeZone: input.command.timeZone,
          };
        } else if (input.command.kind === "cancel") {
          values = { nextWakeAt: null, status: "cancelled" };
        } else {
          values = {
            actorUserId: context.userId,
            nextWakeAt: now,
            returnRequestId: randomUUID(),
            status: "returning",
          };
        }
        [saved] = await tx
          .update(mailSnooze)
          .set({
            ...values,
            code: null,
            leaseToken: null,
            leaseUntil: null,
            message: null,
            updatedAt: now,
            version: current.version + 1,
          })
          .where(
            and(
              eq(mailSnooze.id, current.id),
              eq(mailSnooze.version, current.version)
            )
          )
          .returning();
        if (saved === undefined) {
          throw new ORPCError("CONFLICT");
        }
      }
      const schedule = saved;
      const [operation] = await tx
        .insert(mailSnoozeOperation)
        .values({
          actorUserId: context.userId,
          createdAt: now,
          expectedVersion: target.expectedVersion,
          id: randomUUID(),
          kind: input.command.kind,
          mailboxId: input.mailboxId,
          requestHash,
          requestId: input.requestId,
          resultingVersion: schedule.version,
          snoozeId: schedule.id,
          status:
            input.command.kind === "snooze" ||
            input.command.kind === "return-now"
              ? "pending"
              : "applied",
          threadId: target.threadId,
          updatedAt: now,
        })
        .returning();
      if (operation !== undefined) {
        operations.push(operation);
      }
    }
    if (operations.length > 0) {
      await tx
        .update(mailbox)
        .set({
          contentRevision: sql`${mailbox.contentRevision} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(mailbox.id, input.mailboxId));
    }
    return {
      operations,
      ownedIds: new Set(operations.map((operation) => operation.id)),
    };
  });
  if (reservation.ownedIds.size === 0 && reservation.operations.length > 0) {
    return await replaySnoozeOperations({
      mailboxId: input.mailboxId,
      operations: reservation.operations,
      targets: input.targets,
    });
  }
  const targets: MailSnoozeTargetResult[] = [];
  for (const target of input.targets) {
    const operation = reservation.operations.find(
      (item) => item.threadId === target.threadId
    );
    if (operation === undefined) {
      targets.push({
        status: "failed",
        threadId: target.threadId,
        ...rejected.get(target.threadId),
      });
      continue;
    }
    if (operation.snoozeId === null || operation.resultingVersion === null) {
      const replay = await replaySnoozeOperations({
        mailboxId: input.mailboxId,
        operations: await readExisting(db),
        targets: [target],
      });
      targets.push(...replay.targets);
      continue;
    }
    const acceptedVersion = operation.resultingVersion;
    const [schedule] = await db
      .select()
      .from(mailSnooze)
      .where(
        and(
          eq(mailSnooze.id, operation.snoozeId),
          eq(mailSnooze.mailboxId, input.mailboxId),
          eq(mailSnooze.version, acceptedVersion),
          isNull(mailSnooze.leaseToken)
        )
      );
    if (schedule === undefined) {
      const replay = await replaySnoozeOperations({
        mailboxId: input.mailboxId,
        operations: await readExisting(db),
        targets: [target],
      });
      targets.push(...replay.targets);
      continue;
    }
    let placementResult:
      | Awaited<ReturnType<typeof applyMailPlacement>>["targets"][number]
      | undefined;
    let failureOwned = true;
    if (
      input.command.kind === "snooze" ||
      input.command.kind === "return-now"
    ) {
      try {
        const hide = input.command.kind === "snooze";
        const placementRequestId = hide
          ? schedule.hideRequestId
          : schedule.returnRequestId;
        if (placementRequestId === null) {
          throw new Error(
            "A returning Snooze requires its reserved request identity."
          );
        }
        const result = await applyMailPlacement({
          context,
          input: {
            command: {
              kind: "set-placement",
              placement: hide ? "done" : "inbox",
            },
            mailboxId: input.mailboxId,
            requestId: placementRequestId,
            targets: [
              {
                messageIds: schedule.hiddenMessageIds,
                threadId: target.threadId,
              },
            ],
          },
          snooze: hide
            ? {
                id: schedule.id,
                kind: "snooze-hide",
                leaseToken: null,
                version: acceptedVersion,
              }
            : {
                id: schedule.id,
                kind: "snooze-return",
                leaseToken: null,
                trigger: "manual",
                version: acceptedVersion,
              },
        });
        [placementResult] = result.targets;
      } catch (error) {
        const failure = describeSnoozeFailure(error);
        failureOwned = await finishSnoozeFailure({
          id: schedule.id,
          leaseToken: null,
          mailboxId: schedule.mailboxId,
          version: acceptedVersion,
          ...failure,
          status: "failed",
        });
        placementResult = {
          status: "failed",
          threadId: target.threadId,
          ...failure,
        };
      }
    }
    const [current] = await db
      .select()
      .from(mailSnooze)
      .where(eq(mailSnooze.id, schedule.id));
    const applied = placementResult
      ? placementResult.status === "applied"
      : operation.status === "applied";
    let journalStatus: "applied" | "uncertain" | "failed" = "failed";
    if (applied) {
      journalStatus = "applied";
    } else if (placementResult?.code === "placement_uncertain") {
      journalStatus = "uncertain";
    }
    const shouldFinalize =
      failureOwned &&
      placementResult?.code !== "placement_pending" &&
      placementResult?.code !== "placement_submitting";
    const [completed] = shouldFinalize
      ? await db
          .update(mailSnoozeOperation)
          .set({
            code: placementResult?.code ?? null,
            message: placementResult?.message ?? null,
            resultingVersion:
              journalStatus === "applied" || journalStatus === "uncertain"
                ? acceptedVersion + 1
                : acceptedVersion,
            status: journalStatus,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(mailSnoozeOperation.id, operation.id),
              eq(mailSnoozeOperation.resultingVersion, acceptedVersion),
              eq(mailSnoozeOperation.status, "pending"),
              journalStatus === "applied"
                ? undefined
                : notExists(
                    db
                      .select({ id: mailSnooze.id })
                      .from(mailSnooze)
                      .where(
                        and(
                          eq(mailSnooze.id, schedule.id),
                          eq(mailSnooze.version, acceptedVersion),
                          isNotNull(mailSnooze.leaseToken)
                        )
                      )
                  )
            )
          )
          .returning()
      : [];
    const currentOperations =
      completed === undefined ? await readExisting(db) : [];
    const journal =
      completed ??
      currentOperations.find((item) => item.id === operation.id) ??
      operation;
    targets.push({
      code:
        journal.status === "applied" ? undefined : (journal.code ?? undefined),
      message:
        journal.status === "applied"
          ? undefined
          : (journal.message ?? undefined),
      messageIds: placementResult?.messageIds,
      operationId: operation.id,
      placementOperationId: placementResult?.operationId,
      snooze:
        current === undefined ? undefined : serializeMailSnoozeState(current),
      status: journal.status === "applied" ? "applied" : "failed",
      threadId: target.threadId,
    });
    if (current?.nextWakeAt) {
      await requestMailSnoozeWake({
        id: current.id,
        mailboxId: current.mailboxId,
      });
    }
  }
  if (reservation.operations.length > 0) {
    await publishMailUpdate({
      mailboxId: input.mailboxId,
      type: "mailbox.changed",
    });
  }
  return { targets };
};

const confirmObservedPlacement = async (input: {
  row: typeof mailSnooze.$inferSelect;
  operation: typeof mailPlacementOperation.$inferSelect;
  phase: "hide" | "return";
  leaseToken: string;
}) =>
  await db.transaction(async (tx) => {
    await tx
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(eq(mailbox.id, input.row.mailboxId))
      .for("update");
    const [current] = await tx
      .select()
      .from(mailSnooze)
      .where(
        and(
          eq(mailSnooze.id, input.row.id),
          eq(mailSnooze.version, input.row.version),
          eq(mailSnooze.leaseToken, input.leaseToken)
        )
      )
      .for("update");
    const [latest] = await tx
      .select()
      .from(mailPlacementOperation)
      .where(
        and(
          eq(mailPlacementOperation.mailboxId, input.row.mailboxId),
          eq(mailPlacementOperation.threadId, input.row.threadId)
        )
      )
      .orderBy(desc(mailPlacementOperation.sequence))
      .limit(1);
    if (
      current === undefined ||
      latest?.id !== input.operation.id ||
      latest.status === "superseded"
    ) {
      return false;
    }
    await tx
      .update(mailPlacementOperation)
      .set({
        code: null,
        message: null,
        status: "applied",
        updatedAt: new Date(),
      })
      .where(eq(mailPlacementOperation.id, latest.id));
    await tx
      .update(mailSnooze)
      .set({
        code: null,
        leaseToken: null,
        leaseUntil: null,
        message: null,
        nextWakeAt: input.phase === "hide" ? new Date() : null,
        status: input.phase === "hide" ? "active" : "returned",
        updatedAt: new Date(),
        version: current.version + 1,
      })
      .where(eq(mailSnooze.id, current.id));
    const acceptedVersion =
      current.status === "uncertain" ? current.version - 1 : current.version;
    await tx
      .update(mailSnoozeOperation)
      .set({
        code: null,
        message: null,
        resultingVersion: current.version + 1,
        status: "applied",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mailSnoozeOperation.snoozeId, current.id),
          eq(mailSnoozeOperation.actorUserId, input.operation.actorUserId),
          eq(mailSnoozeOperation.mailboxId, current.mailboxId),
          eq(mailSnoozeOperation.threadId, current.threadId),
          eq(
            mailSnoozeOperation.kind,
            input.phase === "hide" ? "snooze" : "return-now"
          ),
          acceptedVersion === 1
            ? isNull(mailSnoozeOperation.expectedVersion)
            : eq(mailSnoozeOperation.expectedVersion, acceptedVersion - 1),
          inArray(mailSnoozeOperation.resultingVersion, [
            acceptedVersion,
            acceptedVersion + 1,
          ]),
          inArray(mailSnoozeOperation.status, ["pending", "uncertain"])
        )
      );
    await tx
      .update(mailbox)
      .set({
        contentRevision: sql`${mailbox.contentRevision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(mailbox.id, current.mailboxId));
    return true;
  });

export const dispatchMailSnooze = async (
  scope: MailSnoozeScope
): Promise<{ nextWakeAt: number | null }> => {
  const [row] = await db
    .select()
    .from(mailSnooze)
    .where(
      and(
        eq(mailSnooze.id, scope.id),
        eq(mailSnooze.mailboxId, scope.mailboxId)
      )
    );
  if (
    row === undefined ||
    !MAIL_SNOOZE_LIVE_STATUSES.some((status) => status === row?.status)
  ) {
    return { nextWakeAt: null };
  }
  if (row.leaseUntil && row.leaseUntil.getTime() > Date.now()) {
    return { nextWakeAt: row.leaseUntil.getTime() };
  }
  if (row.actorUserId === null) {
    await finishSnoozeFailure({
      ...scope,
      code: "access_lost",
      leaseToken: row.leaseToken,
      message: "This snooze needs someone with access to return the mail.",
      status: "suspended",
      version: row.version,
    });
    await publishMailUpdate({
      mailboxId: scope.mailboxId,
      type: "mailbox.changed",
    });
    const [current] = await db
      .select({ nextWakeAt: mailSnooze.nextWakeAt })
      .from(mailSnooze)
      .where(
        and(
          eq(mailSnooze.id, scope.id),
          eq(mailSnooze.mailboxId, scope.mailboxId)
        )
      );
    return { nextWakeAt: current?.nextWakeAt?.getTime() ?? null };
  }
  const context: MailRequestContext = {
    signal: AbortSignal.timeout(30_000),
    userId: row.actorUserId,
  };
  let selected: Awaited<ReturnType<typeof authorizeMailPlacement>>;
  try {
    selected = await authorizeMailPlacement(context, scope.mailboxId);
  } catch (error) {
    if (
      error instanceof ORPCError &&
      [
        "NOT_FOUND",
        "FORBIDDEN",
        "UNAUTHORIZED",
        "MAILBOX_SCOPE_REPAIR_REQUIRED",
      ].some((code) => code === error.code)
    ) {
      await finishSnoozeFailure({
        ...scope,
        code: "access_lost",
        leaseToken: row.leaseToken,
        message: "This snooze needs someone with access to return the mail.",
        status: "suspended",
        version: row.version,
      });
      await publishMailUpdate({
        mailboxId: scope.mailboxId,
        type: "mailbox.changed",
      });
      const [current] = await db
        .select({ nextWakeAt: mailSnooze.nextWakeAt })
        .from(mailSnooze)
        .where(
          and(
            eq(mailSnooze.id, scope.id),
            eq(mailSnooze.mailboxId, scope.mailboxId)
          )
        );
      return { nextWakeAt: current?.nextWakeAt?.getTime() ?? null };
    }
    throw error;
  }
  const claim = await db.transaction(async (tx) => {
    await tx
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(eq(mailbox.id, scope.mailboxId))
      .for("update");
    const [current] = await tx
      .select()
      .from(mailSnooze)
      .where(
        and(
          eq(mailSnooze.id, scope.id),
          eq(mailSnooze.mailboxId, scope.mailboxId)
        )
      )
      .for("update");
    if (
      current === undefined ||
      !MAIL_SNOOZE_LIVE_STATUSES.some((status) => status === current.status)
    ) {
      return { kind: "ended" as const };
    }
    if (
      current.version !== row.version ||
      current.actorUserId !== context.userId
    ) {
      return {
        at: Date.now() + 100,
        kind: "wait" as const,
      };
    }
    if (current.leaseUntil && current.leaseUntil.getTime() > Date.now()) {
      return {
        at: current.leaseUntil.getTime(),
        kind: "wait" as const,
      };
    }
    if (current.status === "suspended" || current.status === "failed") {
      return { kind: "ended" as const };
    }
    if (
      current.status === "active" &&
      current.returnAt.getTime() > Date.now()
    ) {
      await tx
        .update(mailSnooze)
        .set({ nextWakeAt: current.returnAt })
        .where(eq(mailSnooze.id, current.id));
      return { at: current.returnAt.getTime(), kind: "wait" as const };
    }
    const token = randomUUID();
    const until = new Date(Date.now() + 60_000);
    const [claimed] = await tx
      .update(mailSnooze)
      .set({
        attempts: current.attempts + 1,
        leaseToken: token,
        leaseUntil: until,
        nextWakeAt: until,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mailSnooze.id, current.id),
          eq(mailSnooze.version, current.version)
        )
      )
      .returning();
    return claimed === undefined
      ? { kind: "ended" as const }
      : { kind: "claimed" as const, row: claimed, token };
  });
  if (claim.kind === "ended") {
    return { nextWakeAt: null };
  }
  if (claim.kind === "wait") {
    return { nextWakeAt: claim.at };
  }
  let dispatchRow = claim.row;
  try {
    const operationId = dispatchRow.returnRequestId
      ? dispatchRow.returnOperationId
      : dispatchRow.hideOperationId;
    const [operation] =
      operationId === null
        ? await db
            .select()
            .from(mailPlacementOperation)
            .where(
              and(
                eq(mailPlacementOperation.mailboxId, dispatchRow.mailboxId),
                eq(mailPlacementOperation.threadId, dispatchRow.threadId),
                eq(mailPlacementOperation.actorUserId, context.userId),
                eq(
                  mailPlacementOperation.requestId,
                  dispatchRow.returnRequestId ?? dispatchRow.hideRequestId
                )
              )
            )
            .limit(1)
        : await db
            .select()
            .from(mailPlacementOperation)
            .where(eq(mailPlacementOperation.id, operationId))
            .limit(1);
    if (dispatchRow.status === "preparing" && operation === undefined) {
      await applyMailPlacement({
        context,
        input: {
          command: { kind: "set-placement", placement: "done" },
          mailboxId: dispatchRow.mailboxId,
          requestId: dispatchRow.hideRequestId,
          targets: [
            {
              messageIds: dispatchRow.hiddenMessageIds,
              threadId: dispatchRow.threadId,
            },
          ],
        },
        snooze: {
          id: dispatchRow.id,
          kind: "snooze-hide",
          leaseToken: claim.token,
          version: dispatchRow.version,
        },
      });
    } else {
      let manualRecovery = false;
      if (
        dispatchRow.status === "returning" &&
        dispatchRow.returnRequestId &&
        operation === undefined
      ) {
        const [manual] = await db
          .select({ id: mailSnoozeOperation.id })
          .from(mailSnoozeOperation)
          .where(
            and(
              eq(mailSnoozeOperation.snoozeId, dispatchRow.id),
              eq(mailSnoozeOperation.actorUserId, context.userId),
              eq(mailSnoozeOperation.kind, "return-now"),
              eq(mailSnoozeOperation.resultingVersion, dispatchRow.version),
              eq(mailSnoozeOperation.status, "pending")
            )
          )
          .limit(1);

        manualRecovery = manual !== undefined;
      }
      const source = await inspectSnoozeSource({
        context,
        provider: selected.provider,
        row: dispatchRow,
      });
      if (
        source.protected ||
        (!manualRecovery && source.reopened) ||
        (dispatchRow.status === "active" &&
          source.messages.some((message) => message.placement === "inbox"))
      ) {
        await finishSnoozeFailure({
          code: "source_reopened",
          id: dispatchRow.id,
          leaseToken: claim.token,
          mailboxId: dispatchRow.mailboxId,
          message: "This conversation changed and is no longer snoozed.",
          status: "superseded",
          version: dispatchRow.version,
        });
      } else if (
        (dispatchRow.status === "preparing" ||
          dispatchRow.status === "uncertain") &&
        !dispatchRow.returnRequestId &&
        operation !== undefined &&
        source.done
      ) {
        await confirmObservedPlacement({
          leaseToken: claim.token,
          operation,
          phase: "hide",
          row: dispatchRow,
        });
      } else if (
        (dispatchRow.status === "returning" ||
          dispatchRow.status === "uncertain") &&
        dispatchRow.returnRequestId &&
        operation !== undefined
      ) {
        if (source.inbox) {
          await confirmObservedPlacement({
            leaseToken: claim.token,
            operation,
            phase: "return",
            row: dispatchRow,
          });
        } else {
          await finishSnoozeFailure({
            code: "return_unconfirmed",
            id: dispatchRow.id,
            leaseToken: claim.token,
            mailboxId: dispatchRow.mailboxId,
            message:
              "The return is still being confirmed. Refresh or choose Return to Inbox.",
            status:
              operation.status === "pending" || operation.status === "failed"
                ? "failed"
                : "uncertain",
            version: dispatchRow.version,
          });
        }
      } else if (dispatchRow.status === "active") {
        const returning = await db.transaction(async (tx) => {
          await tx
            .select({ id: mailbox.id })
            .from(mailbox)
            .where(eq(mailbox.id, dispatchRow.mailboxId))
            .for("update");
          const [current] = await tx
            .select()
            .from(mailSnooze)
            .where(
              and(
                eq(mailSnooze.id, dispatchRow.id),
                eq(mailSnooze.version, dispatchRow.version),
                eq(mailSnooze.leaseToken, claim.token)
              )
            )
            .for("update");
          const [latest] = await tx
            .select()
            .from(mailPlacementOperation)
            .where(
              and(
                eq(mailPlacementOperation.mailboxId, dispatchRow.mailboxId),
                eq(mailPlacementOperation.threadId, dispatchRow.threadId)
              )
            )
            .orderBy(desc(mailPlacementOperation.sequence))
            .limit(1);
          if (
            current === undefined ||
            current.status !== "active" ||
            current.returnAt.getTime() > Date.now()
          ) {
            return null;
          }
          if (
            !current.hideOperationId ||
            latest?.id !== current.hideOperationId ||
            latest.status !== "applied"
          ) {
            return null;
          }
          const [updated] = await tx
            .update(mailSnooze)
            .set({
              returnOperationId: null,
              returnRequestId: randomUUID(),
              status: "returning",
              updatedAt: new Date(),
              version: current.version + 1,
            })
            .where(eq(mailSnooze.id, current.id))
            .returning();
          return updated ?? null;
        });
        if (returning && returning.returnRequestId) {
          dispatchRow = returning;
          await applyMailPlacement({
            context,
            input: {
              command: { kind: "set-placement", placement: "inbox" },
              mailboxId: returning.mailboxId,
              requestId: returning.returnRequestId,
              targets: [
                {
                  messageIds: returning.hiddenMessageIds,
                  threadId: returning.threadId,
                },
              ],
            },
            snooze: {
              id: returning.id,
              kind: "snooze-return",
              leaseToken: claim.token,
              trigger: "due",
              version: returning.version,
            },
          });
        } else {
          await finishSnoozeFailure({
            code: "predecessor_lost",
            id: dispatchRow.id,
            leaseToken: claim.token,
            mailboxId: dispatchRow.mailboxId,
            message: "This snooze needs confirmation before mail can return.",
            status: "suspended",
            version: dispatchRow.version,
          });
        }
      } else if (
        dispatchRow.status === "returning" &&
        operation === undefined &&
        dispatchRow.returnRequestId
      ) {
        await applyMailPlacement({
          context,
          input: {
            command: { kind: "set-placement", placement: "inbox" },
            mailboxId: dispatchRow.mailboxId,
            requestId: dispatchRow.returnRequestId,
            targets: [
              {
                messageIds: dispatchRow.hiddenMessageIds,
                threadId: dispatchRow.threadId,
              },
            ],
          },
          snooze: {
            id: dispatchRow.id,
            kind: "snooze-return",
            leaseToken: claim.token,
            trigger: manualRecovery ? "manual" : "due",
            version: dispatchRow.version,
          },
        });
      } else {
        await finishSnoozeFailure({
          code: "confirmation_required",
          id: dispatchRow.id,
          leaseToken: claim.token,
          mailboxId: dispatchRow.mailboxId,
          message:
            "This snooze needs confirmation. Refresh before trying again.",
          status: "failed",
          version: dispatchRow.version,
        });
      }
    }
    const [current] = await db
      .select()
      .from(mailSnooze)
      .where(
        and(
          eq(mailSnooze.id, dispatchRow.id),
          eq(mailSnooze.mailboxId, dispatchRow.mailboxId)
        )
      );
    if (
      current !== undefined &&
      current.version === dispatchRow.version + 1 &&
      current.actorUserId === dispatchRow.actorUserId &&
      current.hideRequestId === dispatchRow.hideRequestId &&
      current.returnRequestId === dispatchRow.returnRequestId
    ) {
      let journalStatus: "applied" | "uncertain" | "failed" = "failed";
      if (current.status === "active" || current.status === "returned") {
        journalStatus = "applied";
      } else if (current.status === "uncertain") {
        journalStatus = "uncertain";
      }
      await db
        .update(mailSnoozeOperation)
        .set({
          code: current.code,
          message: current.message,
          resultingVersion:
            journalStatus === "applied" || journalStatus === "uncertain"
              ? current.version
              : dispatchRow.version,
          status: journalStatus,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mailSnoozeOperation.snoozeId, current.id),
            eq(mailSnoozeOperation.resultingVersion, dispatchRow.version),
            eq(mailSnoozeOperation.status, "pending")
          )
        );
    }
    await db
      .update(mailSnooze)
      .set({ leaseToken: null, leaseUntil: null })
      .where(
        and(
          eq(mailSnooze.id, dispatchRow.id),
          eq(mailSnooze.version, dispatchRow.version),
          eq(mailSnooze.leaseToken, claim.token)
        )
      );
    await publishMailUpdate({
      mailboxId: scope.mailboxId,
      type: "mailbox.changed",
    });
    return { nextWakeAt: current?.nextWakeAt?.getTime() ?? null };
  } catch (error) {
    const failure = describeSnoozeFailure(error);
    if (
      error instanceof ORPCError &&
      [
        "MAILBOX_SCOPE_REPAIR_REQUIRED",
        "FORBIDDEN",
        "NOT_FOUND",
        "UNAUTHORIZED",
      ].some((code) => code === error.code)
    ) {
      await finishSnoozeFailure({
        ...failure,
        id: dispatchRow.id,
        leaseToken: claim.token,
        mailboxId: dispatchRow.mailboxId,
        status: "suspended",
        version: dispatchRow.version,
      });
      await publishMailUpdate({
        mailboxId: scope.mailboxId,
        type: "mailbox.changed",
      });
      const [current] = await db
        .select({ nextWakeAt: mailSnooze.nextWakeAt })
        .from(mailSnooze)
        .where(
          and(
            eq(mailSnooze.id, dispatchRow.id),
            eq(mailSnooze.mailboxId, dispatchRow.mailboxId)
          )
        );
      return { nextWakeAt: current?.nextWakeAt?.getTime() ?? null };
    }
    const delay = Math.min(
      300_000,
      5000 * 2 ** Math.min(dispatchRow.attempts, 6)
    );
    const nextWakeAt = new Date(Date.now() + delay);
    await db
      .update(mailSnooze)
      .set({
        code: failure.code,
        leaseToken: null,
        leaseUntil: null,
        message: failure.message,
        nextWakeAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mailSnooze.id, dispatchRow.id),
          eq(mailSnooze.version, dispatchRow.version),
          eq(mailSnooze.leaseToken, claim.token)
        )
      );
    await publishMailUpdate({
      mailboxId: scope.mailboxId,
      type: "mailbox.changed",
    });
    const [current] = await db
      .select({ nextWakeAt: mailSnooze.nextWakeAt })
      .from(mailSnooze)
      .where(
        and(
          eq(mailSnooze.id, dispatchRow.id),
          eq(mailSnooze.mailboxId, dispatchRow.mailboxId)
        )
      );
    return { nextWakeAt: current?.nextWakeAt?.getTime() ?? null };
  }
};

export const handleSnoozeInbound = async (input: {
  mailboxId: string;
  threadId: string;
  messageId: string;
}) => {
  const [selected] = await db
    .select({ provider: mailbox.provider })
    .from(mailbox)
    .where(eq(mailbox.id, input.mailboxId));
  let eligible = false;
  if (selected?.provider === "managed") {
    const [message] = await db
      .select({
        direction: managedMailMessage.direction,
        state: managedMailMessage.mailboxState,
        threadId: managedMailMessage.threadId,
      })
      .from(managedMailMessage)
      .where(
        and(
          eq(managedMailMessage.mailboxId, input.mailboxId),
          eq(managedMailMessage.id, input.messageId)
        )
      );
    eligible =
      message?.threadId === input.threadId &&
      message.direction === "inbound" &&
      message.state === "active";
  } else if (selected?.provider === "gmail") {
    const [message] = await db
      .select({
        deletedAt: gmailCapturedMessage.deletedAt,
        snapshot: gmailCapturedMessage.snapshot,
      })
      .from(gmailCapturedMessage)
      .where(
        and(
          eq(gmailCapturedMessage.mailboxId, input.mailboxId),
          eq(gmailCapturedMessage.messageId, input.messageId)
        )
      );
    eligible =
      message?.deletedAt === null &&
      message.snapshot?.threadId === input.threadId &&
      message.snapshot.labelIds.includes("INBOX") &&
      !message.snapshot.labelIds.some((label) =>
        ["SENT", "DRAFT", "SPAM", "TRASH"].includes(label)
      );
  }
  if (!eligible) {
    return;
  }
  const changed = await db.transaction(async (tx) => {
    await tx
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(eq(mailbox.id, input.mailboxId))
      .for("update");
    const [current] = await tx
      .select()
      .from(mailSnooze)
      .where(
        and(
          eq(mailSnooze.mailboxId, input.mailboxId),
          eq(mailSnooze.threadId, input.threadId)
        )
      )
      .for("update");
    if (
      current === undefined ||
      !["preparing", "active", "returning"].includes(current.status) ||
      current.knownIncomingMessageIds.includes(input.messageId)
    ) {
      return false;
    }
    await tx
      .update(mailSnooze)
      .set({
        code: "new_reply",
        leaseToken: null,
        leaseUntil: null,
        message: null,
        nextWakeAt: null,
        status: "superseded",
        updatedAt: new Date(),
        version: current.version + 1,
      })
      .where(eq(mailSnooze.id, current.id));
    await tx
      .update(mailbox)
      .set({
        contentRevision: sql`${mailbox.contentRevision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(mailbox.id, input.mailboxId));
    return true;
  });
  if (changed) {
    await publishMailUpdate({
      mailboxId: input.mailboxId,
      type: "mailbox.changed",
    });
  }
};
