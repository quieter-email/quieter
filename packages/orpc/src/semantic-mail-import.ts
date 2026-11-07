import { ORPCError } from "@orpc/server";
import {
  getGmailCapturedSnapshot,
  isGmailServiceError,
  listGmailMessageIds,
} from "@quieter/gmail";

import { runAuthorizedGmailMailbox } from "./gmail-mailbox-access";
import { writeGmailCapturedMessage } from "./mail-capture";
import { assertAccessibleMailbox } from "./mailbox/service";

export const advanceSemanticMailImport = async (input: {
  mailboxId: string;
  pageToken: string | null;
  pendingIds: string[];
  signal?: AbortSignal;
  userId: string;
}): Promise<{
  complete: boolean;
  pageToken: string | null;
  pendingIds: string[];
}> => {
  input.signal?.throwIfAborted();
  const mailbox = await assertAccessibleMailbox(input);
  if (mailbox.provider !== "gmail") {
    throw new ORPCError("BAD_REQUEST", {
      message: "This mailbox does not need a mail search import.",
    });
  }
  try {
    return await runAuthorizedGmailMailbox(input, async (accessToken) => {
      let page: {
        messageIds: string[];
        nextPageToken?: string | null;
      };
      if (input.pendingIds.length > 0) {
        page = {
          messageIds: input.pendingIds,
          nextPageToken: input.pageToken,
        };
      } else {
        try {
          page = await listGmailMessageIds(accessToken, {
            includeSpamTrash: false,
            maxResults: 50,
            pageToken: input.pageToken ?? undefined,
            query: "-in:drafts -in:spam -in:trash",
            signal: input.signal,
          });
        } catch (error) {
          if (
            input.pageToken &&
            isGmailServiceError(error) &&
            error.status === 400
          ) {
            return { complete: false, pageToken: null, pendingIds: [] };
          }
          throw error;
        }
      }
      const messageIds = [...new Set(page.messageIds)];
      const batch = messageIds.slice(0, 25);
      for (let offset = 0; offset < batch.length; offset += 5) {
        input.signal?.throwIfAborted();
        const snapshots = await Promise.allSettled(
          batch.slice(offset, offset + 5).map(async (messageId) => {
            try {
              return await getGmailCapturedSnapshot(
                accessToken,
                messageId,
                input.signal
              );
            } catch (error) {
              if (isGmailServiceError(error) && error.status === 404) {
                return null;
              }
              throw error;
            }
          })
        );
        input.signal?.throwIfAborted();
        await assertAccessibleMailbox(input);
        for (const result of snapshots) {
          if (
            result.status === "fulfilled" &&
            result.value !== null &&
            !result.value.labelIds.some((label) =>
              ["DRAFT", "SPAM", "TRASH"].includes(label)
            )
          ) {
            await writeGmailCapturedMessage({
              mailboxId: input.mailboxId,
              snapshot: result.value,
              source: "search",
            });
          }
        }
        const failed = snapshots.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") {
          throw failed.reason;
        }
      }
      const pendingIds = messageIds.slice(batch.length);
      return {
        complete: pendingIds.length === 0 && !page.nextPageToken,
        pageToken: page.nextPageToken ?? null,
        pendingIds,
      };
    });
  } catch (error) {
    input.signal?.throwIfAborted();
    if (error instanceof ORPCError) {
      throw error;
    }
    throw new Error(
      "Mail search preparation could not finish. It will retry.",
      { cause: error }
    );
  }
};
