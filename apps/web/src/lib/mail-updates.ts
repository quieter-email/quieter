import { mailUpdateSchema } from "@quieter/mail/updates";
import type { MailUpdate } from "@quieter/mail/updates";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type { ListMessagesPageResult } from "./mail";
import { rpc } from "./orpc";

export const connectMailUpdates = (queryClient: QueryClient) => {
  let disposed = false;
  let suspended = true;
  let socket: WebSocket | undefined;
  let connecting = false;
  let handshake: AbortController | undefined;
  let generation = 0;
  let backgroundTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectDelay = 1000;
  let refreshing = false;
  const pending = new Map<
    string,
    { types: Set<MailUpdate["type"]>; revision?: string }
  >();
  const seen = new Set<string>();

  const isRevisionSynced = (mailboxId: string, revision: string) => {
    const queries = queryClient.getQueryCache().findAll({
      predicate: ({ queryKey }) =>
        queryKey[0] === "messages" &&
        queryKey[1] === mailboxId &&
        queryKey.at(-1) === "live-sync",
      type: "active",
    });
    return (
      queries.length > 0 &&
      queries.every((query) => {
        const data = queryClient.getQueryData<ListMessagesPageResult>(
          query.queryKey
        );
        return (
          data?.historyId !== undefined &&
          /^\d+$/u.test(data.historyId) &&
          BigInt(data.historyId) >= BigInt(revision)
        );
      })
    );
  };
  const scheduleRefresh = () => {
    if (
      refreshing ||
      disposed ||
      suspended ||
      pending.size === 0 ||
      refreshTimer !== undefined
    ) {
      return;
    }
    refreshTimer = setTimeout(() => {
      // oxlint-disable-next-line no-use-before-define -- The timer runs after refresh is initialized.
      void refresh();
    }, 150);
  };
  const refresh = async () => {
    refreshTimer = undefined;
    if (refreshing || disposed || suspended || pending.size === 0) {
      return;
    }
    const changes = new Map(pending);
    pending.clear();
    const syncedRevisions = new Set<string>();
    for (const [mailboxId, change] of changes) {
      if (
        change.revision !== undefined &&
        isRevisionSynced(mailboxId, change.revision)
      ) {
        syncedRevisions.add(mailboxId);
      }
    }
    refreshing = true;
    try {
      await queryClient.invalidateQueries(
        {
          predicate: ({ queryKey }) => {
            const [root] = queryKey;
            if (root === "mailboxes") {
              return changes.has("*");
            }
            if (root === "gmail-unread-counts") {
              return [...changes.values()].some((change) =>
                change.types.has("mailbox.changed")
              );
            }
            const mailboxId = String(
              root === "message-thread" ? queryKey[2] : queryKey[1]
            );
            const types =
              changes.get("*")?.types ?? changes.get(mailboxId)?.types;
            if (root === "gmail-useful-details") {
              return changes.has("*") || types?.has("details.changed") === true;
            }
            if (
              types === undefined ||
              (!types.has("mailbox.changed") && !types.has("labels.changed"))
            ) {
              return false;
            }
            if (root === "message-thread") {
              return (
                queryClient.getQueryCache().findAll({
                  predicate: ({ queryKey: key }) =>
                    key[0] === "messages" &&
                    key[1] === mailboxId &&
                    key.at(-1) === "live-sync",
                  type: "active",
                }).length === 0
              );
            }
            if (
              root === "messages" &&
              queryKey.length === 4 &&
              // oxlint-disable-next-line unicorn/prefer-array-some -- TanStack QueryCache exposes find, not Array.some.
              queryClient.getQueryCache().find({
                exact: true,
                queryKey: [...queryKey, "live-sync"],
                type: "active",
              }) !== undefined
            ) {
              return false;
            }
            if (
              root === "messages" &&
              queryKey.at(-1) === "live-sync" &&
              syncedRevisions.has(mailboxId) &&
              !changes.has("*")
            ) {
              return false;
            }
            if (root === "gmail-labels") {
              return changes.has("*") || types.has("labels.changed");
            }
            return [
              "messages",
              "gmail-labels",
              "managed-label-counts",
            ].includes(String(root));
          },
        },
        { cancelRefetch: false }
      );
    } finally {
      refreshing = false;
      scheduleRefresh();
    }
  };
  const requestRefresh = (
    mailboxId = "*",
    type: MailUpdate["type"] = "mailbox.changed",
    revision?: string
  ) => {
    const change = pending.get(mailboxId);
    if (change === undefined) {
      pending.set(mailboxId, { revision, types: new Set([type]) });
    } else {
      if (type === "mailbox.changed") {
        change.revision =
          revision !== undefined &&
          (!change.types.has(type) ||
            (change.revision !== undefined &&
              BigInt(revision) > BigInt(change.revision)))
            ? revision
            : change.revision;
        if (revision === undefined) {
          change.revision = undefined;
        }
      }
      change.types.add(type);
    }
    scheduleRefresh();
  };
  const disconnect = () => {
    generation += 1;
    connecting = false;
    handshake?.abort();
    handshake = undefined;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    clearInterval(heartbeatTimer);
    clearTimeout(openTimer);
    const previous = socket;
    socket = undefined;
    previous?.close();
  };
  const reconnect = () => {
    if (
      disposed ||
      suspended ||
      !navigator.onLine ||
      reconnectTimer !== undefined
    ) {
      return;
    }
    reconnectTimer = setTimeout(
      () => {
        reconnectTimer = undefined;
        // oxlint-disable-next-line no-use-before-define -- The reconnect timer runs after connection setup is initialized.
        void connect();
      },
      reconnectDelay + Math.random() * 500
    );
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  };
  const connect = async () => {
    if (
      disposed ||
      suspended ||
      connecting ||
      socket !== undefined ||
      !navigator.onLine
    ) {
      return;
    }
    connecting = true;
    const attempt = generation;
    const controller = new AbortController();
    handshake = controller;
    const timeout = setTimeout(() => {
      controller.abort();
    }, 15_000);
    try {
      const connection = await rpc.mail.createUpdateConnection(undefined, {
        signal: controller.signal,
      });
      if (disposed || suspended || generation !== attempt || !connection.url) {
        return;
      }
      const next = new WebSocket(connection.url);
      socket = next;
      openTimer = setTimeout(() => {
        next.close();
      }, 15_000);
      let lastMessage = Date.now();
      next.addEventListener("open", () => {
        if (socket !== next) {
          return;
        }
        clearTimeout(openTimer);
        reconnectDelay = 1000;
        requestRefresh();
        heartbeatTimer = setInterval(() => {
          if (Date.now() - lastMessage > 90_000) {
            next.close();
            return;
          }
          if (next.readyState === WebSocket.OPEN) {
            next.send('{"action":"ping"}');
          }
        }, 30_000);
      });
      next.addEventListener("message", (message) => {
        if (socket !== next) {
          return;
        }
        lastMessage = Date.now();
        try {
          const event = mailUpdateSchema.safeParse(
            JSON.parse(String(message.data))
          );
          if (!event.success || seen.has(event.data.eventId)) {
            return;
          }
          seen.add(event.data.eventId);
          if (seen.size > 500) {
            seen.delete(seen.values().next().value ?? "");
          }
          requestRefresh(
            event.data.mailboxId,
            event.data.type,
            event.data.revision
          );
        } catch {
          /* Ignore malformed frames. */
        }
      });
      next.addEventListener("close", () => {
        if (socket !== next) {
          return;
        }
        socket = undefined;
        clearTimeout(openTimer);
        clearInterval(heartbeatTimer);
        reconnect();
      });
      next.addEventListener("error", () => {
        next.close();
      });
    } catch {
      reconnect();
    } finally {
      clearTimeout(timeout);
      if (handshake === controller) {
        handshake = undefined;
      }
      if (generation === attempt) {
        connecting = false;
      }
    }
  };
  const activityChanged = () => {
    const active =
      document.visibilityState === "visible" && document.hasFocus();
    if (active && navigator.onLine) {
      clearTimeout(backgroundTimer);
      backgroundTimer = undefined;
      const wasSuspended = suspended;
      suspended = false;
      if (wasSuspended) {
        requestRefresh();
      }
      void connect();
    } else {
      suspended = true;
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
      backgroundTimer ??= setTimeout(() => {
        backgroundTimer = undefined;
        disconnect();
      }, 30_000);
    }
  };
  const offline = () => {
    suspended = true;
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
    disconnect();
  };
  window.addEventListener("focus", activityChanged);
  window.addEventListener("blur", activityChanged);
  window.addEventListener("online", activityChanged);
  window.addEventListener("offline", offline);
  document.addEventListener("visibilitychange", activityChanged);
  activityChanged();
  const recoveryTimer = setInterval(() => {
    if (
      document.visibilityState === "visible" &&
      document.hasFocus() &&
      navigator.onLine
    ) {
      requestRefresh();
    }
  }, 60_000);
  return () => {
    disposed = true;
    disconnect();
    clearTimeout(backgroundTimer);
    clearTimeout(refreshTimer);
    clearInterval(recoveryTimer);
    window.removeEventListener("focus", activityChanged);
    window.removeEventListener("blur", activityChanged);
    window.removeEventListener("online", activityChanged);
    window.removeEventListener("offline", offline);
    document.removeEventListener("visibilitychange", activityChanged);
  };
};

export const useMailUpdates = (
  queryClient: QueryClient,
  userId: string | undefined
) => {
  useEffect(
    () => (userId ? connectMailUpdates(queryClient) : undefined),
    [queryClient, userId]
  );
};
