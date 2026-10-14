import { createHash, randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { gmailComposeOperation } from "@quieter/database/schema";
import {
  createDraft,
  deleteDraft,
  findGmailComposeDraft,
  findGmailComposeSentMessage,
  getDraft,
  isGmailServiceError,
  sendDraft,
  sendRawMessage,
  updateDraft,
} from "@quieter/gmail";
import type { GmailDraft, GmailMessage } from "@quieter/gmail";
import { parseDraftMessage } from "@quieter/gmail/compose";
import {
  buildMimeMessage,
  normalizeComposeBodyHtml,
} from "@quieter/mail/compose/mime";
import type { composeDraftInputSchema } from "@quieter/mail/compose/schema";
import { reportError } from "@quieter/observability";
import { and, eq, inArray, lt, or } from "drizzle-orm";
import type { z } from "zod";

import { hashRequest } from "./request-hash";

type ComposeDraftInput = z.infer<typeof composeDraftInputSchema>;
type ComposeOperation = typeof gmailComposeOperation.$inferSelect;
const UNCERTAIN_SEND_MESSAGE =
  "The delivery result is still being confirmed. Check Sent before sending again.";
const DRAFT_CONFLICT_MESSAGE =
  "This draft changed elsewhere. Reopen it before saving or sending again.";
const DRAFT_RECONCILIATION_WINDOW_MS = 120_000;

const hashComposeRequest = async (draft: ComposeDraftInput) => {
  const files = await Promise.all(
    [
      ...draft.inlineImages,
      ...draft.attachments.filter((asset) => !asset.isInline),
    ].map(async (asset) => {
      if (!(asset.file instanceof Blob)) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "An attachment is missing its file content. Attach the file again.",
        });
      }
      return {
        contentId: "contentId" in asset ? asset.contentId : undefined,
        hash: createHash("sha256")
          .update(Buffer.from(await asset.file.arrayBuffer()))
          .digest("hex"),
        isInline: asset.isInline,
        mimeType: asset.mimeType,
        name: asset.name,
      };
    })
  );
  return hashRequest({
    bodyHtml: normalizeComposeBodyHtml(draft),
    bodyText: draft.bodyText,
    draftAnchor: draft.draftAnchor,
    files,
    headers: draft.headers,
    recipients: draft.recipients,
    replyContext: draft.replyContext,
    subject: draft.subject,
  });
};

const prepareComposeOperation = async (input: {
  draftId?: string | null;
  kind: "save" | "send";
  mailboxId: string;
  operationKey: string;
  requestHash: string;
}): Promise<ComposeOperation> => {
  const now = new Date();
  const id = randomUUID();
  await db
    .insert(gmailComposeOperation)
    .values({
      ...input,
      createdAt: now,
      id,
      messageHeaderId: `<${id}@compose.quieter.email>`,
      status: "prepared",
      updatedAt: now,
    })
    .onConflictDoNothing();
  let [operation] = await db
    .select()
    .from(gmailComposeOperation)
    .where(
      and(
        eq(gmailComposeOperation.mailboxId, input.mailboxId),
        eq(gmailComposeOperation.operationKey, input.operationKey)
      )
    )
    .limit(1);
  if (operation === undefined) {
    throw new ORPCError("INTERNAL_SERVER_ERROR");
  }
  if (
    (operation.status === "rejected" || operation.status === "prepared") &&
    operation.requestHash !== input.requestHash
  ) {
    const [updated] = await db
      .update(gmailComposeOperation)
      .set({
        requestHash: input.requestHash,
        status: "prepared",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(gmailComposeOperation.id, operation.id),
          eq(gmailComposeOperation.status, operation.status),
          eq(gmailComposeOperation.requestHash, operation.requestHash)
        )
      )
      .returning();
    if (updated !== undefined) {
      operation = updated;
    }
  }
  if (operation.requestHash !== input.requestHash) {
    throw new ORPCError("CONFLICT", {
      data:
        input.kind === "send"
          ? { deliveryUncertain: true }
          : { draftConflict: true },
      message:
        input.kind === "send"
          ? "This message already has a send attempt. Check Sent before sending different content."
          : DRAFT_CONFLICT_MESSAGE,
    });
  }
  return operation;
};

const withComposeDraftLock = async <Result>(
  mailboxId: string,
  identity: string,
  run: () => Promise<Result>
): Promise<Result> => {
  const now = new Date();
  const owner = randomUUID();
  const operationKey = `lock:${identity}`;
  await db
    .insert(gmailComposeOperation)
    .values({
      createdAt: now,
      id: randomUUID(),
      kind: "save",
      mailboxId,
      messageHeaderId: "",
      operationKey,
      requestHash: "",
      status: "prepared",
      updatedAt: now,
    })
    .onConflictDoNothing();
  const [lock] = await db
    .update(gmailComposeOperation)
    .set({ requestHash: owner, status: "submitting", updatedAt: now })
    .where(
      and(
        eq(gmailComposeOperation.mailboxId, mailboxId),
        eq(gmailComposeOperation.operationKey, operationKey),
        or(
          inArray(gmailComposeOperation.status, ["prepared", "accepted"]),
          lt(gmailComposeOperation.updatedAt, new Date(now.getTime() - 120_000))
        )
      )
    )
    .returning({ id: gmailComposeOperation.id });
  if (lock === undefined) {
    throw new ORPCError("CONFLICT", {
      message:
        "This draft is being saved or sent elsewhere. Try again in a moment.",
    });
  }
  try {
    return await run();
  } finally {
    await db
      .update(gmailComposeOperation)
      .set({ status: "accepted", updatedAt: new Date() })
      .where(
        and(
          eq(gmailComposeOperation.id, lock.id),
          eq(gmailComposeOperation.requestHash, owner)
        )
      )
      .catch((error: unknown) => {
        reportError(error, { operation: "compose:gmail-release-draft-lock" });
      });
  }
};

const claimComposeOperation = async (operation: ComposeOperation) => {
  const [claimed] = await db
    .update(gmailComposeOperation)
    .set({ status: "submitting", updatedAt: new Date() })
    .where(
      and(
        eq(gmailComposeOperation.id, operation.id),
        eq(gmailComposeOperation.requestHash, operation.requestHash),
        inArray(gmailComposeOperation.status, ["prepared", "rejected"])
      )
    )
    .returning();
  if (claimed === undefined) {
    throw new ORPCError("CONFLICT", {
      data: operation.kind === "send" ? { deliveryUncertain: true } : undefined,
      message:
        operation.kind === "send"
          ? UNCERTAIN_SEND_MESSAGE
          : DRAFT_CONFLICT_MESSAGE,
    });
  }
  return claimed;
};

const recordComposeFailure = async (
  operation: ComposeOperation,
  error: unknown
): Promise<never> => {
  const rejected =
    isGmailServiceError(error) &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408;
  await db
    .update(gmailComposeOperation)
    .set({ status: rejected ? "rejected" : "unknown", updatedAt: new Date() })
    .where(eq(gmailComposeOperation.id, operation.id));
  if (rejected) {
    if (
      operation.draftId &&
      isGmailServiceError(error) &&
      error.status === 404
    ) {
      throw new ORPCError("CONFLICT", {
        data: { draftConflict: true },
        message: DRAFT_CONFLICT_MESSAGE,
      });
    }
    throw error;
  }
  reportError(error, { operation: "compose:gmail-uncertain-write" });
  throw new ORPCError("CONFLICT", {
    data: operation.kind === "send" ? { deliveryUncertain: true } : undefined,
    message:
      operation.kind === "send"
        ? UNCERTAIN_SEND_MESSAGE
        : "The draft save result is still being confirmed. Reopen Drafts before saving again.",
  });
};

const acceptComposeOperation = async (
  operation: ComposeOperation,
  response: NonNullable<ComposeOperation["response"]>
) => {
  await db
    .update(gmailComposeOperation)
    .set({ response, status: "accepted", updatedAt: new Date() })
    .where(eq(gmailComposeOperation.id, operation.id))
    .catch((error: unknown) => {
      reportError(error, { operation: "compose:gmail-persist-acceptance" });
    });
};

const toSavedComposeDraft = async (
  accessToken: string,
  draft: ComposeDraftInput,
  saved: GmailDraft,
  signal: AbortSignal
) => {
  let hydrated = saved;
  if (hydrated.message?.payload === undefined) {
    try {
      const candidate = await getDraft(accessToken, saved.id, signal);
      if (
        saved.message?.id === undefined ||
        candidate.message?.id === saved.message.id
      ) {
        hydrated = candidate;
      }
    } catch (error) {
      if (isGmailServiceError(error) && error.status === 404) {
        throw new ORPCError("CONFLICT", {
          data: { draftConflict: true },
          message: DRAFT_CONFLICT_MESSAGE,
        });
      }
      reportError(error, { operation: "compose:gmail-draft-hydration" });
    }
  }
  const parsed = parseDraftMessage(hydrated, {
    bodyHtml: normalizeComposeBodyHtml(draft),
    bodyText: draft.bodyText,
  });
  const messageId = hydrated.message?.id ?? saved.message?.id;
  return {
    attachments: draft.attachments.map((asset, index) => ({
      gmailAttachmentId: parsed.attachments[index]?.attachmentId,
      id: asset.id,
      isInline: false as const,
      mimeType: asset.mimeType,
      name: asset.name,
      size: asset.size,
      sourceMessageId: messageId,
    })),
    baseRevision: messageId,
    bodyHtml: parsed.bodyHtml || draft.bodyHtml,
    bodyText: parsed.bodyText || draft.bodyText,
    draftAnchor: parsed.draftAnchor ?? draft.draftAnchor ?? null,
    draftId: saved.id,
    inlineImages: draft.inlineImages.map((asset) => ({
      contentId: asset.contentId,
      gmailAttachmentId: parsed.inlineImages.find(
        (image) =>
          image.contentId.toLowerCase() === asset.contentId.toLowerCase()
      )?.attachmentId,
      id: asset.id,
      isInline: true as const,
      mimeType: asset.mimeType,
      name: asset.name,
      size: asset.size,
      sourceMessageId: messageId,
    })),
    messageId,
    recipients: draft.recipients,
    replyContext: draft.replyContext ?? null,
    subject: draft.subject,
  };
};

export const saveGmailDraft = async (
  accessToken: string,
  mailboxId: string,
  inputDraft: ComposeDraftInput,
  signal?: AbortSignal
) => {
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(45_000)])
    : AbortSignal.timeout(45_000);
  const requestHash = await hashComposeRequest(inputDraft);
  let draft = inputDraft;
  const [attemptedSend] = await db
    .select({ id: gmailComposeOperation.id })
    .from(gmailComposeOperation)
    .where(
      and(
        eq(gmailComposeOperation.mailboxId, mailboxId),
        eq(
          gmailComposeOperation.operationKey,
          `send:${draft.sendOperationId ?? draft.localId}`
        ),
        inArray(gmailComposeOperation.status, [
          "submitting",
          "unknown",
          "accepted",
        ])
      )
    )
    .limit(1);
  if (attemptedSend !== undefined) {
    throw new ORPCError("CONFLICT", {
      data: { deliveryUncertain: true },
      message: UNCERTAIN_SEND_MESSAGE,
    });
  }
  if (!draft.draftId) {
    const [created] = await db
      .select()
      .from(gmailComposeOperation)
      .where(
        and(
          eq(gmailComposeOperation.mailboxId, mailboxId),
          eq(gmailComposeOperation.operationKey, `save:create:${draft.localId}`)
        )
      )
      .limit(1);
    if (created?.status === "accepted" && created.response) {
      if (created.requestHash === requestHash) {
        return await toSavedComposeDraft(
          accessToken,
          draft,
          {
            id: created.response.id,
            message: {
              id: created.response.messageId ?? "",
              threadId: created.response.threadId ?? "",
            },
          },
          requestSignal
        );
      }
      draft = {
        ...draft,
        baseRevision: created.response.messageId,
        draftId: created.response.id,
        messageId: created.response.messageId,
      };
    }
  }
  const baseRevision = draft.baseRevision ?? draft.messageId;
  if (draft.draftId && !baseRevision) {
    throw new ORPCError("CONFLICT", {
      data: { draftConflict: true },
      message: DRAFT_CONFLICT_MESSAGE,
    });
  }
  return await withComposeDraftLock(
    mailboxId,
    draft.draftId ?? `local:${draft.localId}`,
    async () => {
      if (draft.draftId) {
        const [pendingSend] = await db
          .select({ id: gmailComposeOperation.id })
          .from(gmailComposeOperation)
          .where(
            and(
              eq(gmailComposeOperation.mailboxId, mailboxId),
              eq(gmailComposeOperation.draftId, draft.draftId),
              eq(gmailComposeOperation.kind, "send"),
              inArray(gmailComposeOperation.status, [
                "submitting",
                "unknown",
                "accepted",
              ])
            )
          )
          .limit(1);
        if (pendingSend !== undefined) {
          throw new ORPCError("CONFLICT", {
            data: { deliveryUncertain: true },
            message: UNCERTAIN_SEND_MESSAGE,
          });
        }
      }
      const operation = await prepareComposeOperation({
        draftId: draft.draftId,
        kind: "save",
        mailboxId,
        operationKey: draft.draftId
          ? `save:${draft.draftId}:${baseRevision}`
          : `save:create:${draft.localId}`,
        requestHash,
      });
      if (operation.status === "accepted" && operation.response) {
        return await toSavedComposeDraft(
          accessToken,
          draft,
          {
            id: operation.response.id,
            message: {
              id: operation.response.messageId ?? "",
              threadId: operation.response.threadId ?? "",
            },
          },
          requestSignal
        );
      }
      if (operation.status === "submitting" || operation.status === "unknown") {
        const recovered = await findGmailComposeDraft(
          accessToken,
          operation.messageHeaderId,
          requestSignal
        );
        if (recovered) {
          await acceptComposeOperation(operation, {
            id: recovered.id,
            messageId: recovered.message?.id,
            threadId: recovered.message?.threadId,
          });
          return await toSavedComposeDraft(
            accessToken,
            draft,
            recovered,
            requestSignal
          );
        }
        const reconciliationExpired =
          Date.now() - operation.updatedAt.getTime() >=
          DRAFT_RECONCILIATION_WINDOW_MS;
        throw new ORPCError(
          reconciliationExpired ? "CONFLICT" : "SERVICE_UNAVAILABLE",
          {
            data: reconciliationExpired ? { draftConflict: true } : undefined,
            message: reconciliationExpired
              ? "The draft save could not be confirmed. Reopen Drafts or recover your edits as a new draft."
              : "The draft save is still being confirmed. Please try again shortly.",
          }
        );
      }
      if (draft.draftId) {
        const current = await getDraft(
          accessToken,
          draft.draftId,
          requestSignal
        ).catch((error: unknown) => {
          if (isGmailServiceError(error) && error.status === 404) {
            throw new ORPCError("CONFLICT", {
              data: { draftConflict: true },
              message: DRAFT_CONFLICT_MESSAGE,
            });
          }
          throw error;
        });
        if (current.message?.id !== baseRevision) {
          throw new ORPCError("CONFLICT", {
            data: { draftConflict: true },
            message: DRAFT_CONFLICT_MESSAGE,
          });
        }
      }
      const raw = Buffer.from(
        await buildMimeMessage(draft, {
          includeQuieterDraftHeaders: true,
          messageId: operation.messageHeaderId,
        })
      ).toString("base64url");
      requestSignal.throwIfAborted();
      await claimComposeOperation(operation);
      let saved: GmailDraft;
      try {
        saved = draft.draftId
          ? await updateDraft(
              accessToken,
              draft.draftId,
              raw,
              draft.replyContext?.threadId,
              requestSignal
            )
          : await createDraft(
              accessToken,
              raw,
              draft.replyContext?.threadId,
              requestSignal
            );
      } catch (error) {
        return await recordComposeFailure(operation, error);
      }
      await acceptComposeOperation(operation, {
        id: saved.id,
        messageId: saved.message?.id,
        threadId: saved.message?.threadId,
      });
      return await toSavedComposeDraft(
        accessToken,
        draft,
        saved,
        requestSignal
      );
    }
  );
};

export const sendGmailMessage = async (
  accessToken: string,
  mailboxId: string,
  inputMessage: ComposeDraftInput,
  signal?: AbortSignal
): Promise<{
  id: string;
  threadId?: string;
  draftCleanupHandled: true;
  idempotent: boolean;
}> => {
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(45_000)])
    : AbortSignal.timeout(45_000);
  let message = inputMessage;
  if (!message.draftId) {
    const [created] = await db
      .select()
      .from(gmailComposeOperation)
      .where(
        and(
          eq(gmailComposeOperation.mailboxId, mailboxId),
          eq(
            gmailComposeOperation.operationKey,
            `save:create:${message.localId}`
          )
        )
      )
      .limit(1);
    if (created?.status === "accepted" && created.response) {
      message = {
        ...message,
        baseRevision: created.response.messageId,
        draftId: created.response.id,
        messageId: created.response.messageId,
      };
    } else if (
      created?.status === "submitting" ||
      created?.status === "unknown"
    ) {
      const recovered = await findGmailComposeDraft(
        accessToken,
        created.messageHeaderId,
        requestSignal
      );
      if (!recovered) {
        const reconciliationExpired =
          Date.now() - created.updatedAt.getTime() >=
          DRAFT_RECONCILIATION_WINDOW_MS;
        throw new ORPCError(
          reconciliationExpired ? "CONFLICT" : "SERVICE_UNAVAILABLE",
          {
            data: {
              ...(reconciliationExpired ? { draftConflict: true } : {}),
              sendRejected: true,
            },
            message: reconciliationExpired
              ? "The draft save could not be confirmed. Reopen Drafts or recover your edits as a new draft."
              : "The draft save is still being confirmed. Please try again shortly.",
          }
        );
      }
      await acceptComposeOperation(created, {
        id: recovered.id,
        messageId: recovered.message?.id,
      });
      message = {
        ...message,
        baseRevision: recovered.message?.id,
        draftId: recovered.id,
        messageId: recovered.message?.id,
      };
    }
  }
  return await withComposeDraftLock(
    mailboxId,
    message.draftId ?? `local:${message.localId}`,
    async () => {
      const requestHash = await hashComposeRequest(message);
      if (message.draftId) {
        const [boundSend] = await db
          .select()
          .from(gmailComposeOperation)
          .where(
            and(
              eq(gmailComposeOperation.mailboxId, mailboxId),
              eq(gmailComposeOperation.draftId, message.draftId),
              eq(gmailComposeOperation.kind, "send"),
              inArray(gmailComposeOperation.status, [
                "submitting",
                "unknown",
                "accepted",
              ])
            )
          )
          .limit(1);
        if (
          boundSend !== undefined &&
          boundSend.operationKey !==
            `send:${message.sendOperationId ?? message.localId}`
        ) {
          throw new ORPCError("CONFLICT", {
            data: { draftConflict: true },
            message:
              "This draft already has a send attempt from another editor. Check Sent before recovering your changes as a new draft.",
          });
        }
      }
      const operation = await prepareComposeOperation({
        draftId: message.draftId,
        kind: "send",
        mailboxId,
        operationKey: `send:${message.sendOperationId ?? message.localId}`,
        requestHash,
      });
      if (operation.status === "accepted" && operation.response) {
        return {
          ...operation.response,
          draftCleanupHandled: true,
          idempotent: true,
        };
      }
      if (operation.status === "submitting" || operation.status === "unknown") {
        const sent = await findGmailComposeSentMessage(
          accessToken,
          operation.messageHeaderId,
          requestSignal
        );
        if (sent) {
          await acceptComposeOperation(operation, {
            id: sent.id,
            threadId: sent.threadId,
          });
          return { ...sent, draftCleanupHandled: true, idempotent: true };
        }
        throw new ORPCError("CONFLICT", {
          data: { deliveryUncertain: true },
          message: UNCERTAIN_SEND_MESSAGE,
        });
      }
      if (message.draftId) {
        const current = await getDraft(
          accessToken,
          message.draftId,
          requestSignal
        ).catch((error: unknown) => {
          if (isGmailServiceError(error) && error.status === 404) {
            throw new ORPCError("CONFLICT", {
              data: { draftConflict: true },
              message: DRAFT_CONFLICT_MESSAGE,
            });
          }
          throw error;
        });
        if (
          current.message?.id !== (message.baseRevision ?? message.messageId)
        ) {
          throw new ORPCError("CONFLICT", {
            data: { draftConflict: true },
            message: DRAFT_CONFLICT_MESSAGE,
          });
        }
      }
      const raw = Buffer.from(
        await buildMimeMessage(message, {
          messageId: operation.messageHeaderId,
        })
      ).toString("base64url");
      requestSignal.throwIfAborted();
      await claimComposeOperation(operation);
      let sent: GmailMessage;
      try {
        sent = message.draftId
          ? await sendDraft(
              accessToken,
              message.draftId,
              raw,
              message.replyContext?.threadId,
              requestSignal
            )
          : await sendRawMessage(
              accessToken,
              raw,
              message.replyContext?.threadId,
              requestSignal
            );
      } catch (error) {
        return await recordComposeFailure(operation, error);
      }
      await acceptComposeOperation(operation, {
        id: sent.id,
        threadId: sent.threadId,
      });
      return { ...sent, draftCleanupHandled: true, idempotent: false };
    }
  );
};

export const deleteGmailComposeDraft = async (
  accessToken: string,
  mailboxId: string,
  input: { draftId: string; baseRevision?: string },
  signal?: AbortSignal
) => {
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(45_000)])
    : AbortSignal.timeout(45_000);
  return await withComposeDraftLock(mailboxId, input.draftId, async () => {
    const [pendingSend] = await db
      .select({ id: gmailComposeOperation.id })
      .from(gmailComposeOperation)
      .where(
        and(
          eq(gmailComposeOperation.mailboxId, mailboxId),
          eq(gmailComposeOperation.draftId, input.draftId),
          eq(gmailComposeOperation.kind, "send"),
          inArray(gmailComposeOperation.status, ["submitting", "unknown"])
        )
      )
      .limit(1);
    if (pendingSend !== undefined) {
      throw new ORPCError("CONFLICT", {
        data: { deliveryUncertain: true },
        message: UNCERTAIN_SEND_MESSAGE,
      });
    }
    try {
      const current = await getDraft(accessToken, input.draftId, requestSignal);
      if (current.message?.id !== input.baseRevision || !input.baseRevision) {
        throw new ORPCError("CONFLICT", {
          data: { draftConflict: true },
          message: DRAFT_CONFLICT_MESSAGE,
        });
      }
      await deleteDraft(accessToken, input.draftId, requestSignal);
    } catch (error) {
      if (!(isGmailServiceError(error) && error.status === 404)) {
        throw error;
      }
    }
    return { deleted: true };
  });
};

export const getGmailComposeSendStatus = async (
  accessToken: string,
  mailboxId: string,
  input: { sendOperationId: string },
  signal?: AbortSignal
): Promise<{
  status: "pending" | "sent" | "rejected";
  id?: string;
  messageId?: string;
  threadId?: string;
}> => {
  const [operation] = await db
    .select()
    .from(gmailComposeOperation)
    .where(
      and(
        eq(gmailComposeOperation.mailboxId, mailboxId),
        eq(gmailComposeOperation.kind, "send"),
        eq(gmailComposeOperation.operationKey, `send:${input.sendOperationId}`)
      )
    )
    .limit(1);
  if (
    operation === undefined ||
    operation.status === "rejected" ||
    operation.status === "prepared"
  ) {
    return { status: "rejected" };
  }
  if (operation.status === "accepted" && operation.response) {
    return {
      ...operation.response,
      messageId: operation.response.id,
      status: "sent",
    };
  }
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
    : AbortSignal.timeout(15_000);
  const sent = await findGmailComposeSentMessage(
    accessToken,
    operation.messageHeaderId,
    requestSignal
  );
  if (sent) {
    await acceptComposeOperation(operation, {
      id: sent.id,
      threadId: sent.threadId,
    });
    return {
      id: sent.id,
      messageId: sent.id,
      status: "sent",
      threadId: sent.threadId,
    };
  }
  return { status: "pending" };
};
