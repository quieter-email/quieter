"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getGmailUnreadCountsQueryKey } from "../mailboxes-query";
import { rpc } from "../orpc";
import { getGmailUsefulDetailsQueryKey } from "./useful-details-query";

const KEEPALIVE_INTERVAL_MS = 1000 * 60 * 5;
const MAX_CONNECTION_ATTEMPTS = 12;
const MAX_RECONNECT_DELAY_MS = 1000 * 30;

const parseMailboxEvent = (value: unknown, mailboxId: string) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("mailboxId" in value) ||
    value.mailboxId !== mailboxId ||
    !("type" in value) ||
    (value.type !== "mailbox-dirty" && value.type !== "mailbox-details-dirty")
  ) {
    return null;
  }

  return value.type;
};

export const useMailboxLiveSync = (input: {
  enabled: boolean;
  mailboxId: string;
  queryClient: QueryClient;
}) => {
  const { enabled, mailboxId, queryClient } = input;

  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- Cleanup closes the socket and clears both timers below.
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let connectionAttempts = 0;
    let disposed = false;
    let keepaliveTimer: number | undefined;
    let reconnectDelay = 1000;
    let reconnectTimer: number | undefined;
    let socket: WebSocket | null = null;

    const clearKeepalive = () => {
      if (keepaliveTimer !== undefined) {
        window.clearInterval(keepaliveTimer);
        keepaliveTimer = undefined;
      }
    };
    const requestSync = () => {
      void queryClient.invalidateQueries(
        {
          predicate: (query) =>
            query.queryKey[0] === "messages" &&
            query.queryKey[1] === mailboxId &&
            query.queryKey.at(-1) === "live-sync",
        },
        { cancelRefetch: false },
      );
      void queryClient.invalidateQueries(
        {
          exact: true,
          queryKey: getGmailUnreadCountsQueryKey(),
        },
        { cancelRefetch: false },
      );
    };
    const requestUsefulDetails = () => {
      void queryClient.invalidateQueries(
        {
          exact: true,
          queryKey: getGmailUsefulDetailsQueryKey(mailboxId),
        },
        { cancelRefetch: false },
      );
    };
    const scheduleReconnect = () => {
      clearKeepalive();
      if (disposed || connectionAttempts >= MAX_CONNECTION_ATTEMPTS) {
        return;
      }

      reconnectTimer = window.setTimeout(() => {
        void connect();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    };
    const connect = async () => {
      connectionAttempts += 1;

      try {
        const connection = await rpc.mail.createLiveSyncConnection({ mailboxId });
        if (disposed || !connection.url) {
          return;
        }

        socket = new WebSocket(connection.url);
        socket.addEventListener("open", () => {
          connectionAttempts = 0;
          reconnectDelay = 1000;
          clearKeepalive();
          keepaliveTimer = window.setInterval(() => {
            if (socket?.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ action: "ping" }));
            }
          }, KEEPALIVE_INTERVAL_MS);
        });
        socket.addEventListener("message", (event) => {
          try {
            const eventType = parseMailboxEvent(JSON.parse(String(event.data)), mailboxId);
            if (eventType === "mailbox-dirty") {
              requestSync();
            } else if (eventType === "mailbox-details-dirty") {
              requestUsefulDetails();
            }
          } catch {
            // Ignore malformed server messages and keep the connection alive.
          }
        });
        socket.addEventListener("close", scheduleReconnect);
        socket.addEventListener("error", () => socket?.close());
      } catch {
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      disposed = true;
      clearKeepalive();
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [enabled, mailboxId, queryClient]);
};
