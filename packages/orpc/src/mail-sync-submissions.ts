import { createHash } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { mailSyncSubmission } from "@quieter/database/schema";
import { findGmailSubmission, isGmailServiceError } from "@quieter/gmail";
import type { composeDraftInputSchema } from "@quieter/mail/compose/schema";
import { reportError } from "@quieter/observability";
import {
  SyncSubmissions,
  SyncSubmissionConflictError,
  SyncSubmissionUncertainError,
} from "@quieter/sync-server/submissions";
import type {
  SyncSubmissionIdentity,
  SyncSubmissionResult,
} from "@quieter/sync-server/submissions";
import { and, asc, eq, lte } from "drizzle-orm";
import type { z } from "zod";

import { hashRequest } from "./request-hash";

export const prepareGmailSubmission = async (
  owner: { mailboxId: string; userId: string },
  draft: z.infer<typeof composeDraftInputSchema>,
  kind: "draft" | "send"
): Promise<SyncSubmissionIdentity> => {
  const files = await Promise.all(
    [...draft.attachments, ...draft.inlineImages].map(async (file) => ({
      contentId: file.contentId,
      hash:
        file.file === undefined
          ? file.gmailAttachmentId
          : createHash("sha256")
              .update(Buffer.from(await file.file.arrayBuffer()))
              .digest("hex"),
      isInline: file.isInline,
      mimeType: file.mimeType,
      name: file.name,
    }))
  );
  const payloadHash = hashRequest({
    baseVersion: draft.baseVersion,
    bodyHtml: draft.bodyHtml,
    bodyText: draft.bodyText,
    draftAnchor: draft.draftAnchor,
    files,
    headers: draft.headers,
    recipients: draft.recipients,
    replyContext: draft.replyContext,
    subject: draft.subject,
  });
  const operationId = hashRequest({
    kind,
    localId: draft.draftId?.trim() || draft.localId,
    owner,
    ...(kind === "draft" ? { payloadHash } : {}),
  });
  return {
    ...owner,
    kind,
    operationId,
    payloadHash,
    recoveryKey: hashRequest({ operationId, payloadHash }),
  };
};

export const performGmailSubmission = async (
  input: SyncSubmissionIdentity,
  accessToken: string,
  execute: () => Promise<SyncSubmissionResult>
) => {
  const submissions = new SyncSubmissions(db, (error) => {
    reportError(error, { operation: "mail_sync_submission" });
  });
  try {
    return await submissions.run(input, {
      execute,
      isRejected: (error) =>
        (isGmailServiceError(error) &&
          [400, 401, 403, 404, 429].includes(error.status)) ||
        (error instanceof ORPCError &&
          typeof error.code === "string" &&
          ["CONFLICT", "BAD_REQUEST", "FORBIDDEN"].includes(error.code)),
      reconcile: async () =>
        (await findGmailSubmission(
          accessToken,
          input.recoveryKey,
          input.kind,
          AbortSignal.timeout(20_000)
        )) ?? null,
    });
  } catch (error) {
    if (error instanceof SyncSubmissionUncertainError) {
      throw new ORPCError("CONFLICT", {
        message:
          input.kind === "send"
            ? "Delivery has not been confirmed yet. Your message is kept here. Retry to check its status; it will not be sent twice."
            : "Your last draft save has not been confirmed yet. Your edits are kept here. Check Drafts before saving a separate copy.",
      });
    }
    if (error instanceof SyncSubmissionConflictError) {
      throw new ORPCError("CONFLICT", {
        message:
          "This message was already submitted with different content. Check Sent before creating another message.",
      });
    }
    throw error;
  }
};

export const recoverGmailSubmissions = async (
  mailboxId: string,
  accessToken: string
) => {
  const pending = await db
    .select()
    .from(mailSyncSubmission)
    .where(
      and(
        eq(mailSyncSubmission.mailboxId, mailboxId),
        eq(mailSyncSubmission.status, "unknown"),
        lte(mailSyncSubmission.nextAttemptAt, new Date())
      )
    )
    .orderBy(asc(mailSyncSubmission.nextAttemptAt))
    .limit(1);
  const submissions = new SyncSubmissions(db, (error) => {
    reportError(error, { operation: "mail_sync_submission_recovery" });
  });
  for (const record of pending) {
    await db
      .update(mailSyncSubmission)
      .set({ nextAttemptAt: new Date(Date.now() + 300_000) })
      .where(
        and(
          eq(mailSyncSubmission.mailboxId, mailboxId),
          eq(mailSyncSubmission.operationId, record.operationId)
        )
      );
    const result = await findGmailSubmission(
      accessToken,
      record.recoveryKey,
      record.kind,
      AbortSignal.timeout(5000)
    );
    if (result !== null && result !== undefined) {
      await submissions.confirm(mailboxId, record.operationId, result);
    }
  }
};
