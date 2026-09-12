import { mailUpdateSchema } from "@quieter/mail/updates";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

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
  const pending = new Set<string>();
  const seen = new Set<string>();

  const refresh = async () => {
    refreshTimer = undefined;
    if (refreshing || disposed || suspended || pending.size === 0) {
      return;
    }
    refreshing = true;
    const mailboxes = new Set(pending);
    pending.clear();
    try {
      await queryClient.invalidateQueries(
        {
          predicate: ({ queryKey }) => {
            const [root] = queryKey;
            if (root === "mailboxes" || root === "gmail-unread-counts") {
              return true;
            }
            if (root === "message-thread") {
              return mailboxes.has("*") || mailboxes.has(String(queryKey[2]));
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
            return (
              [
                "messages",
                "gmail-labels",
                "managed-label-counts",
                "gmail-useful-details",
              ].includes(String(root)) &&
              (mailboxes.has("*") || mailboxes.has(String(queryKey[1])))
            );
          },
        },
        { cancelRefetch: false }
      );
    } finally {
      refreshing = false;
      if (pending.size > 0 && !disposed) {
        refreshTimer = setTimeout(() => {
          void refresh();
        }, 150);
      }
    }
  };
  const requestRefresh = (mailboxId = "*") => {
    pending.add(mailboxId);
    if (refreshTimer === undefined && !refreshing) {
      refreshTimer = setTimeout(() => {
        void refresh();
      }, 150);
    }
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
          requestRefresh(event.data.mailboxId);
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
    const active = document.visibilityState === "visible";
    if (active && navigator.onLine) {
      clearTimeout(backgroundTimer);
      backgroundTimer = undefined;
      suspended = false;
      requestRefresh();
      void connect();
    } else {
      backgroundTimer ??= setTimeout(() => {
        backgroundTimer = undefined;
        suspended = true;
        disconnect();
      }, 30_000);
    }
  };
  const offline = () => {
    suspended = true;
    disconnect();
  };
  window.addEventListener("focus", activityChanged);
  window.addEventListener("blur", activityChanged);
  window.addEventListener("online", activityChanged);
  window.addEventListener("offline", offline);
  document.addEventListener("visibilitychange", activityChanged);
  activityChanged();
  const recoveryTimer = setInterval(() => {
    if (document.visibilityState === "visible" && navigator.onLine) {
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
