import { ORPCError } from "@orpc/client";
import { isExpectedClientError } from "@quieter/app/lib/client-error-reporting";
import type { MessageListItem } from "@quieter/app/lib/mail";
import { rpc } from "@quieter/app/lib/orpc";
import {
  isGmailSandboxMailboxId,
  isManagedSandboxMailboxId,
} from "@quieter/app/lib/sandbox-mailbox";
import * as Sentry from "@sentry/react";
import { useEffect, useEffectEvent, useRef } from "react";

export const useBriefMailboxActivity = (
  sources: readonly {
    mailboxId: string;
    message?: Pick<MessageListItem, "receivedAt" | "internalDate">;
  }[],
  enabled = true
) => {
  const lastRecordedAt = useRef(new Map<string, number>());
  const lastAttemptedAt = useRef(new Map<string, number>());
  const pendingRequests = useRef(new Map<string, AbortController>());

  const recordActivity = useEffectEvent((resume = false) => {
    if (
      !enabled ||
      document.visibilityState !== "visible" ||
      !navigator.onLine
    ) {
      return;
    }
    const now = Date.now();
    const recordMailboxActivity = async (
      mailboxId: string,
      controller: AbortController
    ) => {
      try {
        await rpc.dailyBrief.activity(
          {
            mailboxId,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          { signal: controller.signal }
        );
        lastRecordedAt.current.set(mailboxId, Date.now());
      } catch (error) {
        if (
          !controller.signal.aborted &&
          !isExpectedClientError(error) &&
          !(error instanceof ORPCError && error.status < 500)
        ) {
          Sentry.captureException(error, {
            tags: { boundary: "brief-mailbox-activity" },
          });
        }
      } finally {
        if (pendingRequests.current.get(mailboxId) === controller) {
          pendingRequests.current.delete(mailboxId);
        }
      }
    };
    for (const { mailboxId, message } of sources) {
      if (message !== undefined) {
        const receivedAt = message.receivedAt
          ? Date.parse(message.receivedAt)
          : Number.NaN;
        const timestamp = Number.isFinite(receivedAt)
          ? receivedAt
          : Number(message.internalDate);
        if (!(timestamp >= now - 7 * 86_400_000 && timestamp <= now)) {
          continue;
        }
      }
      if (
        isGmailSandboxMailboxId(mailboxId) ||
        isManagedSandboxMailboxId(mailboxId) ||
        pendingRequests.current.has(mailboxId) ||
        now - (lastRecordedAt.current.get(mailboxId) ?? 0) < 3_600_000 ||
        (!resume &&
          now - (lastAttemptedAt.current.get(mailboxId) ?? 0) < 60_000)
      ) {
        continue;
      }
      const controller = new AbortController();
      lastAttemptedAt.current.set(mailboxId, now);
      pendingRequests.current.set(mailboxId, controller);
      void recordMailboxActivity(mailboxId, controller);
    }
  });

  useEffect(() => {
    recordActivity();
  }, [enabled, sources]);

  useEffect(() => {
    const requests = pendingRequests.current;
    const resume = () => {
      recordActivity(true);
    };
    const pause = () => {
      for (const controller of requests.values()) {
        controller.abort();
      }
      requests.clear();
      lastAttemptedAt.current.clear();
    };
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("pagehide", pause);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("pagehide", pause);
      document.removeEventListener("visibilitychange", resume);
      pause();
    };
  }, []);
};
