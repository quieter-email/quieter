import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { mailCache } from "./mail-cache";
import { pendingMailMutations } from "./mail-mutation-state";
import { getThreadWithDetailsOptions } from "./mail/thread-query";

const threadSchema = z.object({
  messages: z.array(z.object({ id: z.string() })),
});
const listSchema = z.object({
  pages: z.array(
    z.object({
      messages: z.array(z.object({ threadId: z.string().optional() })),
    })
  ),
});

export const bindMailCache = (client: QueryClient) => {
  let disposed = false;
  let pinned = new Set<string>();
  let prefetching = false;
  const queued = new Map<string, { mailboxId: string; threadId: string }>();

  const prefetch = async () => {
    if (
      prefetching ||
      disposed ||
      document.visibilityState !== "visible" ||
      !navigator.onLine
    ) {
      return;
    }
    prefetching = true;
    try {
      while (
        queued.size > 0 &&
        document.visibilityState === "visible" &&
        navigator.onLine
      ) {
        if (disposed) {
          break;
        }
        const batch = [...queued.entries()].slice(0, 2);
        for (const [key] of batch) {
          queued.delete(key);
        }
        await Promise.all(
          batch.map(async ([, { mailboxId, threadId }]) => {
            await client.prefetchQuery(
              getThreadWithDetailsOptions(mailboxId, threadId)
            );
          })
        );
      }
    } finally {
      prefetching = false;
    }
  };

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
        void mailCache.removeMailbox(mailboxId);
      } else if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        Number(error.status) === 404
      ) {
        void mailCache.removeItem(`quieter-cache-${event.query.queryHash}`);
        if (key[0] === "message-thread") {
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
    if (
      event.type !== "updated" ||
      event.action.type !== "success" ||
      key[0] !== "messages" ||
      key.length !== 4 ||
      key[3] !== "" ||
      typeof mailboxId !== "string" ||
      !event.query.isActive()
    ) {
      return;
    }
    if (pendingMailMutations.get(client)?.has(mailboxId) === true) {
      return;
    }
    const parsed = listSchema.safeParse(event.query.state.data);
    if (!parsed.success) {
      return;
    }
    for (const message of parsed.data.pages[0]?.messages.slice(0, 5) ?? []) {
      if (message.threadId) {
        queued.set(JSON.stringify([mailboxId, message.threadId]), {
          mailboxId,
          threadId: message.threadId,
        });
      }
    }
    void prefetch();
  });
  return () => {
    disposed = true;
    queued.clear();
    unsubscribe();
    for (const key of pinned) {
      mailCache.protect(key, false);
    }
  };
};
