import { ORPCError } from "@orpc/server";
import type { DatabaseExecutor } from "@quieter/database/client";
import {
  outlookCredential,
  outlookMessage,
  outlookMessageFolder,
  outlookSyncState,
} from "@quieter/database/schema";
import {
  analyzeMailMessage,
  boundMailCaptureContent,
} from "@quieter/mail/capture";
import type { CapturedMailSnapshot } from "@quieter/mail/capture";
import { outlookSystemFoldersSchema } from "@quieter/outlook/graph";
import type { OutlookSystemFolders } from "@quieter/outlook/graph";
import { normalizeOutlookMessage } from "@quieter/outlook/messages";
import { and, eq, exists, inArray, isNull, ne, sql } from "drizzle-orm";

import { outlookProjectionSchema } from "./projection";
import type { OutlookProjection } from "./projection";

export const createOutlookCapture = async (input: {
  projection: OutlookProjection;
  systemFolders: OutlookSystemFolders;
}) => {
  const { projection } = input;
  const message = await normalizeOutlookMessage({
    attachments: projection.attachments,
    message: projection.message,
    systemFolders: input.systemFolders,
  });
  const headers = [...(projection.message.internetMessageHeaders ?? [])];
  for (const [name, value] of [
    ["From", message.from],
    ["To", message.to],
    ["Cc", message.cc],
    ["Bcc", message.bcc],
    ["Subject", message.subject],
    ["Reply-To", message.replyTo],
    ["Message-ID", message.messageHeaderId],
    ["References", message.references],
    ["In-Reply-To", message.inReplyTo],
    ["Date", message.date],
  ]) {
    if (
      name !== undefined &&
      value !== undefined &&
      !headers.some(
        (header) => header.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      headers.push({ name, value });
    }
  }
  const bounded = boundMailCaptureContent({
    bodyHtml: message.bodyHtml,
    bodyText: message.bodyText,
    headers,
  });
  const snapshot: CapturedMailSnapshot = {
    ...bounded,
    attachments: message.attachments ?? [],
    id: message.id,
    internalDate: message.internalDate ?? null,
    labelIds: message.labelIds ?? [],
    providerRevision: projection.message.changeKey,
    threadId: message.threadId,
    truncation: {
      attachments: projection.truncation.attachments,
      bodyHtml: bounded.truncation.bodyHtml || projection.truncation.bodyHtml,
      bodyText: bounded.truncation.bodyText || projection.truncation.bodyText,
      headers: bounded.truncation.headers || projection.truncation.headers,
    },
  };
  const analysis = analyzeMailMessage(snapshot);
  analysis.truncated ||= Object.values(snapshot.truncation).some(Boolean);
  return { analysis, message, snapshot };
};

export const loadOutlookCapturedMessages = async (input: {
  database: DatabaseExecutor;
  mailboxId: string;
  messageIds?: string[];
  threadIds?: string[];
}) => {
  if (input.messageIds?.length === 0 || input.threadIds?.length === 0) {
    return [];
  }
  const [state] = await input.database
    .select({ systemFolders: outlookSyncState.systemFolders })
    .from(outlookSyncState)
    .innerJoin(
      outlookCredential,
      and(
        eq(outlookCredential.mailboxId, outlookSyncState.mailboxId),
        eq(outlookCredential.generation, outlookSyncState.generation),
        eq(outlookCredential.status, "connected")
      )
    )
    .where(eq(outlookSyncState.mailboxId, input.mailboxId))
    .limit(1);
  if (state === undefined) {
    return [];
  }
  const systemFolders = outlookSystemFoldersSchema.parse(state.systemFolders);
  const rows = await input.database
    .select()
    .from(outlookMessage)
    .where(
      and(
        eq(outlookMessage.mailboxId, input.mailboxId),
        isNull(outlookMessage.deletedAt),
        ne(outlookMessage.contentState, "metadata"),
        exists(
          input.database
            .select({ messageId: outlookMessageFolder.messageId })
            .from(outlookMessageFolder)
            .where(
              and(
                eq(outlookMessageFolder.mailboxId, outlookMessage.mailboxId),
                eq(outlookMessageFolder.messageId, outlookMessage.messageId),
                eq(
                  outlookMessageFolder.folderId,
                  sql`${outlookMessage.projection}->'message'->>'parentFolderId'`
                )
              )
            )
        ),
        input.messageIds === undefined
          ? undefined
          : inArray(outlookMessage.messageId, input.messageIds),
        input.threadIds === undefined
          ? undefined
          : inArray(outlookMessage.threadId, input.threadIds)
      )
    )
    .limit(1001);
  if (rows.length > 1000) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Choose a smaller set of messages to analyze.",
    });
  }
  const captures: Awaited<ReturnType<typeof createOutlookCapture>>[] = [];
  for (let offset = 0; offset < rows.length; offset += 4) {
    captures.push(
      ...(await Promise.all(
        rows.slice(offset, offset + 4).map(async (row) => {
          const projection = outlookProjectionSchema.parse(row.projection);
          if (
            projection.kind === "metadata" ||
            projection.kind !== row.contentState ||
            projection.message.id !== row.messageId ||
            projection.message.conversationId !== row.threadId ||
            projection.message.changeKey !== row.changeKey
          ) {
            throw new Error(
              "Mailbox content projection does not match its current revision."
            );
          }
          return await createOutlookCapture({ projection, systemFolders });
        })
      ))
    );
  }
  return captures;
};
