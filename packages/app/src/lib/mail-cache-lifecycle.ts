import { mailCache } from "@quieter/app/lib/mail-cache";
import { disposeMailboxMutations } from "@quieter/app/lib/mail-mutations";
import {
  getThreadQueryKey,
  getThreadWithDetailsOptions,
} from "@quieter/app/lib/mail/thread-query";
import { getMailboxesQueryKey } from "@quieter/app/lib/mailboxes-query";
import { subscribeQuerySessionInvalidation } from "@quieter/app/lib/query-persister";
import { CancelledError } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { canPrefetchInBackground } from "./background-prefetch";

const threadSchema = z.object({
  messages: z.array(z.object({ id: z.string() })),
});
const mailboxAccessSchema = z.object({
  groups: z.array(
    z.object({ mailboxes: z.array(z.object({ id: z.string() })) })
  ),
});
const mailboxQueryRoots = new Set([
  "gmail-labels",
  "label-organization",
  "label-suggestions",
  "managed-label-counts",
  "messages",
  "reminders",
  "verification-codes",
]);
const readAccessibleMailboxes = (data: unknown) => {
  const parsed = mailboxAccessSchema.safeParse(data);
  return parsed.success
    ? new Set(
        parsed.data.groups.flatMap(({ mailboxes }) =>
          mailboxes.map(({ id }) => id)
        )
      )
    : undefined;
};
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
export const THREAD_PRELOAD_LIMIT = 60;

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
      latest = candidates.slice(0, THREAD_PRELOAD_LIMIT);
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
  const blockedMailboxes = new Set<string>();
  let accessibleMailboxes = readAccessibleMailboxes(
    client.getQueryData(getMailboxesQueryKey())
  );
  const removeMailboxAccess = (mailboxId: string) => {
    blockedMailboxes.add(mailboxId);
    disposeMailboxMutations(client, mailboxId);
    for (const [key, candidate] of candidates) {
      if (candidate.mailboxId === mailboxId) {
        candidates.delete(key);
      }
    }
    if (intent?.mailboxId === mailboxId) {
      clearTimeout(intentTimer);
      intent = null;
    }
    for (const listener of accessLossListeners.get(client) ?? []) {
      listener({ mailboxId });
    }
    client.removeQueries({
      predicate: ({ queryKey: [root, scope, threadMailbox] }) =>
        root === "message-thread"
          ? threadMailbox === mailboxId
          : scope === mailboxId && mailboxQueryRoots.has(String(root)),
    });
    void mailCache.removeMailbox(mailboxId);
  };
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
    const fetching = client.isFetching({ queryKey: ["message-thread"] });
    if (active >= 3 || fetching >= 3) {
      return;
    }
    const intentional = intent;
    intent = null;
    const next =
      intentional && !blockedMailboxes.has(intentional.mailboxId)
        ? [intentional]
        : [];
    if (canPrefetchInBackground() && active < 2 && fetching === active) {
      for (const [key, entry] of candidates) {
        if (!attempted.has(key) && !blockedMailboxes.has(entry.mailboxId)) {
          next.push(entry);
        }
      }
    }
    const candidate = next.find((entry) => {
      const query = client.getQueryCache().find({
        queryKey: getThreadQueryKey(entry.mailboxId, entry.threadId),
      });
      return query?.isActive() !== true;
    });
    if (!candidate) {
      return;
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
    try {
      await client.query(
        getThreadWithDetailsOptions(
          candidate.mailboxId,
          candidate.threadId,
          true,
          candidate.expectedMessage,
          { prefetch: true }
        )
      );
    } catch (error) {
      if (error instanceof CancelledError) {
        attempted.delete(candidateKey);
      } else if (
        !(
          typeof error === "object" &&
          error !== null &&
          "status" in error &&
          error.status === 404
        )
      ) {
        blockedMailboxes.add(candidate.mailboxId);
      }
    }
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
    blockedMailboxes.clear();
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
        if (candidate && !blockedMailboxes.has(candidate.mailboxId)) {
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
            .filter((entry) => !blockedMailboxes.has(entry.mailboxId))
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
    if (
      key.length === 1 &&
      key[0] === "mailboxes" &&
      event.type === "updated" &&
      event.action.type === "success"
    ) {
      const next = readAccessibleMailboxes(event.query.state.data);
      if (next !== undefined) {
        const previous = accessibleMailboxes;
        accessibleMailboxes = next;
        for (const mailboxId of previous ?? []) {
          if (!next.has(mailboxId)) {
            removeMailboxAccess(mailboxId);
          }
        }
        for (const mailboxId of next) {
          if (previous?.has(mailboxId) !== true) {
            blockedMailboxes.delete(mailboxId);
          }
        }
      }
    }
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
        removeMailboxAccess(mailboxId);
        void client.invalidateQueries({ queryKey: getMailboxesQueryKey() });
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
  const unsubscribeSession = subscribeQuerySessionInvalidation(client, () => {
    disposed = true;
    clearTimeout(intentTimer);
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
    unsubscribeSession();
    for (const key of pinned) {
      mailCache.protect(key, false);
    }
  };
};
