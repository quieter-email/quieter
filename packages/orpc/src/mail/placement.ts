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
  getThreadWithDetails,
} from "@quieter/gmail";
import type {
  MailMutationResult,
  MailMutationTargetResult,
} from "@quieter/mail/data-plane";
import { reportError } from "@quieter/observability";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { callGmail } from "../gmail-request";
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
  await db
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
  context,
  input,
}: {
  context: MailRequestContext;
  input: MailInputs["applyChanges"] & {
    command: { kind: "set-placement"; placement: "done" | "inbox" };
  };
}): Promise<MailMutationResult> => {
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
  const now = new Date();
  const { operations, ownedIds } = await db.transaction(async (tx) => {
    await tx
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(eq(mailbox.id, input.mailboxId))
      .for("update");
    const existing = await tx
      .select()
      .from(mailPlacementOperation)
      .where(requestCondition);
    if (existing.length > 0) {
      if (
        existing.some((operation) => operation.requestHash !== requestHash) ||
        existing.length !== input.targets.length
      ) {
        throw new ORPCError("CONFLICT", {
          message:
            "This action identity was already used for a different request.",
        });
      }
      return { operations: existing, ownedIds: new Set<string>() };
    }
    const inserted = await tx
      .insert(mailPlacementOperation)
      .values(
        input.targets.map((target) => ({
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
  const results: MailMutationTargetResult[] = [];
  for (const target of input.targets) {
    const operation = operations.find(
      (item) => item.threadId === target.threadId
    );
    if (operation === undefined) {
      throw new ORPCError("INTERNAL_SERVER_ERROR");
    }
    if (!ownedIds.has(operation.id)) {
      results.push(toPlacementResult(operation, true));
      continue;
    }
    let dispatched = false;
    try {
      context.signal?.throwIfAborted();
      let messages: PlacementMessage[];
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
          );
        messages = records.map((message): PlacementMessage => {
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
        });
      } else {
        const thread = await callGmail(
          context,
          input.mailboxId,
          async (accessToken, signal) =>
            await getThreadWithDetails(
              accessToken,
              target.threadId,
              signal,
              async (snapshot) => {
                await writeGmailCapturedMessage({
                  mailboxId: input.mailboxId,
                  snapshot,
                  source: "on_demand",
                });
              }
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
      const commit = async (accessToken?: string) =>
        await db.transaction(async (tx) => {
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
            if (accessToken === undefined) {
              throw new Error(
                "Placement dispatch requires an authorized mailbox token."
              );
            }
            for (let offset = 0; offset < messageIds.length; offset += 4) {
              const metadata = await Promise.all(
                messageIds
                  .slice(offset, offset + 4)
                  .map(
                    async (messageId) =>
                      await getGmailCaptureMetadata(accessToken, messageId)
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
              async (accessToken) => await commit(accessToken)
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
          });
        }).catch((error: unknown) => {
          reportError(error, { operation: "placement-refresh-metadata" });
        });
      }
    } catch (error) {
      if (
        (!(error instanceof ORPCError) ||
          typeof error.code !== "string" ||
          ![
            "BAD_REQUEST",
            "CONFLICT",
            "FORBIDDEN",
            "NOT_FOUND",
            "UNAUTHORIZED",
          ].includes(error.code)) &&
        !(error instanceof Error && error.name === "AbortError")
      ) {
        reportError(error, { operation: "mail-placement" });
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
      } else if (error instanceof ORPCError && typeof error.code === "string") {
        failure = { code: error.code, message: error.message };
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
