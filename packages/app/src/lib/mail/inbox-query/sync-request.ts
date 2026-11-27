import { createORPCErrorFromJson, isORPCErrorJson } from "@orpc/client";
import { rpc } from "@quieter/app/lib/orpc";
import type { MailboxSyncDelta } from "@quieter/mail/messages";
import type { QueryClient } from "@tanstack/react-query";

type SyncInput = Parameters<typeof rpc.mail.syncMailbox>[0];
type SyncRequest = ReturnType<
  typeof Promise.withResolvers<MailboxSyncDelta>
> & {
  input: SyncInput;
  signal: AbortSignal;
};

const mailboxBatches = new WeakMap<QueryClient, Map<string, SyncRequest[]>>();

const pullMailboxChanges = async (requests: readonly SyncRequest[]) => {
  const active = requests.filter((request) => {
    if (request.signal.aborted) {
      request.reject(request.signal.reason);
      return false;
    }
    return true;
  });
  const [first] = active;
  if (first === undefined) {
    return;
  }
  if (active.length === 1) {
    try {
      first.resolve(
        await rpc.mail.syncMailbox(first.input, { signal: first.signal })
      );
    } catch (error) {
      first.reject(error);
    }
    return;
  }

  const controller = new AbortController();
  const listeners = active.map((request) => {
    const abort = () => {
      request.reject(request.signal.reason);
      if (active.every(({ signal }) => signal.aborted)) {
        controller.abort();
      }
    };
    request.signal.addEventListener("abort", abort, { once: true });
    return { abort, signal: request.signal };
  });

  try {
    const deltas = await rpc.mail.pullMailboxChanges(
      {
        mailboxId: first.input.mailboxId,
        windows: active.map(({ input }) => ({
          category: input.category,
          startChangeVersion: input.startChangeVersion,
          startHistoryId: input.startHistoryId,
          targetChangeVersion: input.targetChangeVersion,
        })),
      },
      { signal: controller.signal }
    );
    for (const [index, request] of active.entries()) {
      const delta = deltas[index];
      if (delta === undefined) {
        request.reject(new Error("Mailbox sync omitted a requested view."));
      } else if ("error" in delta) {
        request.reject(
          isORPCErrorJson(delta.error)
            ? createORPCErrorFromJson(delta.error)
            : new Error("Could not synchronize the requested mailbox view.")
        );
      } else {
        request.resolve(delta);
      }
    }
  } catch (error) {
    for (const request of active) {
      request.reject(error);
    }
  } finally {
    for (const { abort, signal } of listeners) {
      signal.removeEventListener("abort", abort);
    }
  }
};

export const requestMailboxDelta = async (
  queryClient: QueryClient,
  input: SyncInput,
  signal: AbortSignal
): Promise<MailboxSyncDelta> => {
  const batches =
    mailboxBatches.get(queryClient) ?? new Map<string, SyncRequest[]>();
  mailboxBatches.set(queryClient, batches);
  const result = Promise.withResolvers<MailboxSyncDelta>();
  const request = { ...result, input, signal };
  const batch = batches.get(input.mailboxId);
  if (batch !== undefined && batch.length < 7) {
    batch.push(request);
  } else {
    const nextBatch = [request];
    batches.set(input.mailboxId, nextBatch);
    queueMicrotask(() => {
      if (batches.get(input.mailboxId) === nextBatch) {
        batches.delete(input.mailboxId);
      }
      void pullMailboxChanges(nextBatch);
    });
  }
  return await result.promise;
};
