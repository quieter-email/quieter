import { mailCache } from "@quieter/app/lib/mail-cache";
import { getThreadWithDetailsOptions } from "@quieter/app/lib/mail/thread-query";
import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";

const threadSchema = z.object({
  messages: z.array(z.object({ id: z.string() })),
});
type MailAccessLoss = { mailboxId: string; threadId?: string };
const accessLossListeners = new WeakMap<
  QueryClient,
  Set<(loss: MailAccessLoss) => void>
>();

export const subscribeMailboxAccessLoss = (
  client: QueryClient,
  listener: (loss: MailAccessLoss) => void
) => {
  const listeners = accessLossListeners.get(client) ?? new Set();
  listeners.add(listener);
  accessLossListeners.set(client, listeners);
  return () => {
    listeners.delete(listener);
  };
};
export type ThreadPreloadCandidate = {
  mailboxId: string;
  threadId: string;
  expectedMessage: NonNullable<
    Parameters<typeof getThreadWithDetailsOptions>[3]
  >;
};

type ThreadPreloader = {
  update: (candidates: readonly ThreadPreloadCandidate[]) => void;
  intent: (candidate: ThreadPreloadCandidate | null) => void;
  dispose: () => void;
};
const preloaders = new WeakMap<
  QueryClient,
  (owner: symbol) => ThreadPreloader
>();

const preloadAttachments = new WeakMap<QueryClient, Set<() => void>>();

export const attachThreadPreloader = (client: QueryClient): ThreadPreloader => {
  const attachmentOwner = Symbol("thread-preloader");
  let current: ThreadPreloader | undefined;
  let latest: readonly ThreadPreloadCandidate[] = [];
  const connect = () => {
    current?.dispose();
    current = preloaders.get(client)?.(attachmentOwner);
    current?.update(latest);
  };
  const attachments = preloadAttachments.get(client) ?? new Set();
  attachments.add(connect);
  preloadAttachments.set(client, attachments);
  connect();
  return {
    dispose: () => {
      attachments.delete(connect);
      current?.dispose();
      latest = [];
    },
    intent: (candidate) => {
      current?.intent(candidate);
    },
    update: (candidates) => {
      latest = candidates.slice(0, 10);
      current?.update(latest);
    },
  };
};

export const bindMailCache = (client: QueryClient) => {
  let disposed = false;
  let pinned = new Set<string>();
  let owner: symbol | undefined;
  let candidates = new Map<string, ThreadPreloadCandidate>();
  let intent: ThreadPreloadCandidate | null = null;
  let intentTimer: ReturnType<typeof setTimeout> | undefined;
  let active = 0;
  let scheduled = false;
  const attempted = new Set<string>();
  const pump = async () => {
    scheduled = false;
    if (
      disposed ||
      typeof document === "undefined" ||
      typeof navigator === "undefined" ||
      document.visibilityState !== "visible" ||
      !navigator.onLine
    ) {
      return;
    }
    const connection =
      typeof navigator !== "undefined" && "connection" in navigator
        ? navigator.connection
        : null;
    const constrained =
      typeof connection === "object" &&
      connection !== null &&
      (("saveData" in connection && connection.saveData === true) ||
        ("effectiveType" in connection &&
          (connection.effectiveType === "slow-2g" ||
            connection.effectiveType === "2g")));
    const fetching = client.isFetching({ queryKey: ["message-thread"] });
    if (active >= 3 || fetching >= 3) {
      return;
    }
    const candidate =
      intent ??
      (!constrained && active < 2 && fetching === active
        ? [...candidates.values()].find(
            (entry) =>
              !attempted.has(
                JSON.stringify([
                  entry.mailboxId,
                  entry.threadId,
                  entry.expectedMessage,
                ])
              )
          )
        : undefined);
    if (!candidate) {
      return;
    }
    if (candidate === intent) {
      intent = null;
    }
    const candidateKey = JSON.stringify([
      candidate.mailboxId,
      candidate.threadId,
      candidate.expectedMessage,
    ]);
    if (candidates.has(candidateKey)) {
      attempted.add(candidateKey);
    }
    active += 1;
    // oxlint-disable-next-line no-use-before-define -- Fill available capacity through the same queue.
    schedule();
    await Promise.allSettled([
      client.query(
        getThreadWithDetailsOptions(
          candidate.mailboxId,
          candidate.threadId,
          true,
          candidate.expectedMessage
        )
      ),
    ]);
    active -= 1;
    // oxlint-disable-next-line no-use-before-define -- Completion schedules the same bounded queue.
    schedule();
  };
  const schedule = () => {
    if (!scheduled && !disposed) {
      scheduled = true;
      queueMicrotask(() => {
        void pump();
      });
    }
  };
  const attach = (nextOwner: symbol): ThreadPreloader => {
    owner = nextOwner;
    candidates.clear();
    attempted.clear();
    intent = null;
    clearTimeout(intentTimer);
    return {
      dispose: () => {
        if (owner === nextOwner) {
          owner = undefined;
          candidates.clear();
          attempted.clear();
          intent = null;
          clearTimeout(intentTimer);
        }
      },
      intent: (candidate) => {
        if (owner !== nextOwner || disposed) {
          return;
        }
        clearTimeout(intentTimer);
        intent = null;
        if (candidate) {
          intentTimer = setTimeout(() => {
            intent = candidate;
            schedule();
          }, 200);
        }
      },
      update: (next) => {
        if (owner !== nextOwner || disposed) {
          return;
        }
        candidates = new Map(
          next
            .slice(0, 10)
            .map((entry) => [
              JSON.stringify([
                entry.mailboxId,
                entry.threadId,
                entry.expectedMessage,
              ]),
              entry,
            ])
        );
        for (const key of attempted) {
          if (!candidates.has(key)) {
            attempted.delete(key);
          }
        }
        schedule();
      },
    };
  };
  preloaders.set(client, attach);
  for (const connect of preloadAttachments.get(client) ?? []) {
    connect();
  }
  globalThis.document?.addEventListener("visibilitychange", schedule);
  globalThis.window?.addEventListener("online", schedule);
  const connection =
    typeof navigator !== "undefined" && "connection" in navigator
      ? navigator.connection
      : null;
  if (connection instanceof EventTarget) {
    connection.addEventListener("change", schedule);
  }

  const unsubscribe = client.getQueryCache().subscribe((event) => {
    const rawKey: unknown = event.query.queryKey;
    if (!Array.isArray(rawKey)) {
      return;
    }
    const key: readonly unknown[] = rawKey;
    const mailboxId = key[0] === "message-thread" ? key[2] : key[1];
    if (
      event.type === "updated" &&
      event.action.type === "error" &&
      (key[0] === "message-thread" ||
        key[0] === "messages" ||
        key[0] === "verification-codes" ||
        key[0] === "gmail-labels") &&
      typeof mailboxId === "string"
    ) {
      const error: unknown = event.action.error;
      if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        ([401, 403].includes(Number(error.status)) ||
          ("data" in error &&
            z.object({ resource: z.literal("mailbox") }).safeParse(error.data)
              .success))
      ) {
        for (const [candidateKey, candidate] of candidates) {
          if (candidate.mailboxId === mailboxId) {
            candidates.delete(candidateKey);
          }
        }
        clearTimeout(intentTimer);
        intent = null;
        for (const listener of accessLossListeners.get(client) ?? []) {
          listener({ mailboxId });
        }
        void mailCache.removeMailbox(mailboxId);
      } else if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        Number(error.status) === 404
      ) {
        void mailCache.removeItem(`quieter-cache-${event.query.queryHash}`);
        if (key[0] === "message-thread") {
          if (typeof key[3] === "string") {
            for (const listener of accessLossListeners.get(client) ?? []) {
              listener({ mailboxId, threadId: key[3] });
            }
          }
          const thread = threadSchema.safeParse(event.query.state.data);
          if (thread.success) {
            for (const message of thread.data.messages) {
              void mailCache.removeItem(
                `body-${JSON.stringify([mailboxId, message.id])}`
              );
            }
          }
        }
      }
    }
    if (key[0] === "message-thread") {
      const next = new Set<string>();
      for (const query of client
        .getQueryCache()
        .findAll({ queryKey: ["message-thread"], type: "active" })) {
        next.add(`quieter-cache-${query.queryHash}`);
        const parsed = threadSchema.safeParse(query.state.data);
        if (parsed.success) {
          for (const message of parsed.data.messages) {
            next.add(`body-${JSON.stringify([query.queryKey[2], message.id])}`);
          }
        }
      }
      for (const entry of pinned) {
        if (!next.has(entry)) {
          mailCache.protect(entry, false);
        }
      }
      for (const entry of next) {
        if (!pinned.has(entry)) {
          mailCache.protect(entry, true);
        }
      }
      pinned = next;
    }
    if (key[0] === "message-thread") {
      schedule();
    }
  });
  return () => {
    disposed = true;
    candidates.clear();
    intent = null;
    clearTimeout(intentTimer);
    preloaders.delete(client);
    globalThis.document?.removeEventListener("visibilitychange", schedule);
    globalThis.window?.removeEventListener("online", schedule);
    if (connection instanceof EventTarget) {
      connection.removeEventListener("change", schedule);
    }
    unsubscribe();
    for (const key of pinned) {
      mailCache.protect(key, false);
    }
  };
};
