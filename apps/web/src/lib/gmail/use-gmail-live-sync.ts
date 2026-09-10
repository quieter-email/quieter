"use client";

import * as Sentry from "@sentry/tanstackstart-react";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { isExpectedClientError } from "../client-error-reporting";
import { getGmailUnreadCountsQueryKey } from "../mailboxes-query";
import { rpc } from "../orpc";
import { getGmailUsefulDetailsQueryKey } from "./useful-details-query";

const KEEPALIVE_INTERVAL_MS = 1000 * 60 * 5;
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
  useEffect((): (() => void) | undefined => {
    if (!enabled) {
      return undefined;
    }

    let connectionAttempts = 0;
    let disposed = false;
    let keepaliveTimer: number | undefined;
    let reconnectDelay = 1000;
    let reconnectTimer: number | undefined;
    let reportedConnectionFailure = false;
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
        { cancelRefetch: false }
      );
      void queryClient.invalidateQueries(
        {
          exact: true,
          queryKey: getGmailUnreadCountsQueryKey(),
        },
        { cancelRefetch: false }
      );
    };
    const requestUsefulDetails = () => {
      void queryClient.invalidateQueries(
        {
          exact: true,
          queryKey: getGmailUsefulDetailsQueryKey(mailboxId),
        },
        { cancelRefetch: false }
      );
    };
    const scheduleReconnect = () => {
      clearKeepalive();
      if (disposed || reconnectTimer !== undefined) {
        return;
      }

      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        void connect();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    };
    const reportConnectionFailure = (
      error: unknown,
      phase: "connection" | "socket-close" | "socket-error",
      details?: { closeCode?: number; endpoint?: string }
    ) => {
      if (
        disposed ||
        reportedConnectionFailure ||
        isExpectedClientError(error)
      ) {
        return;
      }

      reportedConnectionFailure = true;
      Sentry.captureException(error, {
        contexts: {
          liveSync: {
            attempt: connectionAttempts,
            closeCode: details?.closeCode,
            endpoint: details?.endpoint,
            online: navigator.onLine,
          },
        },
        tags: {
          boundary: "GmailLiveSync",
          phase,
          transport: "websocket",
        },
      });
    };
    const connect = async () => {
      connectionAttempts += 1;

      try {
        const connection = await rpc.mail.createLiveSyncConnection({
          mailboxId,
        });
        if (
          disposed ||
          connection.url === null ||
          connection.url === undefined ||
          connection.url === ""
        ) {
          return;
        }

        const nextSocket = new WebSocket(connection.url);
        socket = nextSocket;
        const endpointUrl = new URL(connection.url);
        const endpoint = `${endpointUrl.origin}${endpointUrl.pathname}`;
        nextSocket.addEventListener("open", () => {
          if (disposed || socket !== nextSocket) {
            nextSocket.close();
            return;
          }

          connectionAttempts = 0;
          reconnectDelay = 1000;
          reportedConnectionFailure = false;
          clearKeepalive();
          keepaliveTimer = window.setInterval(() => {
            if (nextSocket.readyState === WebSocket.OPEN) {
              nextSocket.send(JSON.stringify({ action: "ping" }));
            }
          }, KEEPALIVE_INTERVAL_MS);
        });
        nextSocket.addEventListener("message", (event) => {
          if (disposed || socket !== nextSocket) {
            return;
          }

          try {
            const eventType = parseMailboxEvent(
              JSON.parse(String(event.data)),
              mailboxId
            );
            if (eventType === "mailbox-dirty") {
              requestSync();
            } else if (eventType === "mailbox-details-dirty") {
              requestUsefulDetails();
            }
          } catch {
            // Ignore malformed server messages and keep the connection alive.
          }
        });
        nextSocket.addEventListener("close", (event) => {
          if (socket !== nextSocket) {
            return;
          }

          socket = null;
          if (!event.wasClean && !disposed) {
            reportConnectionFailure(
              new Error("Gmail live sync connection closed unexpectedly."),
              "socket-close",
              { closeCode: event.code, endpoint }
            );
          }
          scheduleReconnect();
        });
        nextSocket.addEventListener("error", () => {
          if (socket !== nextSocket) {
            return;
          }

          reportConnectionFailure(
            new Error("Gmail live sync connection failed."),
            "socket-error",
            {
              endpoint,
            }
          );
        });
      } catch (error) {
        reportConnectionFailure(error, "connection");
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
