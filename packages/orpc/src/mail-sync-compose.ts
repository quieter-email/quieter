import { ORPCError } from "@orpc/server";
import { reportError } from "@quieter/observability";
import {
  fetchGmailSyncThreads,
  gmailSyncProvider,
  projectGmailThreads,
} from "@quieter/sync-server/gmail";
import {
  assertProviderLease,
  SyncProviderBusyError,
  withProviderLease,
} from "@quieter/sync-server/lease";

import { mailSyncServices } from "./mail-sync-runtime";

export const withGmailComposeReplication = async <Result>(
  mailboxId: string,
  accessToken: string,
  run: () => Promise<{ result: Result; threadIds: string[] }>
): Promise<Result> => {
  const { repository, bodies, enqueue } = mailSyncServices();
  try {
    return await withProviderLease(
      repository,
      mailboxId,
      async (state, leaseId) => {
        const { result, threadIds } = await run();
        try {
          const threads = await fetchGmailSyncThreads(
            gmailSyncProvider(accessToken, AbortSignal.timeout(30_000)),
            bodies,
            mailboxId,
            threadIds
          );
          await repository.transaction(mailboxId, async (context) => {
            await assertProviderLease(context, leaseId);
            await projectGmailThreads(
              context,
              threads,
              state.inventoryGeneration ?? undefined
            );
          });
        } catch (error) {
          // The provider already accepted the edit. History recovery must not turn that success into a repeated write.
          reportError(error, { operation: "mail_sync_compose_projection" });
        }
        try {
          await enqueue(mailboxId);
        } catch (error) {
          reportError(error, { operation: "mail_sync_compose_wake" });
        }
        return result;
      }
    );
  } catch (error) {
    if (error instanceof SyncProviderBusyError) {
      throw new ORPCError("RATE_LIMITED", {
        message:
          "Another mailbox change is finishing. Please try saving again.",
      });
    }
    throw error;
  }
};
