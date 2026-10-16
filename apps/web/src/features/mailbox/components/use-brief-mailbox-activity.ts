import { ORPCError } from "@orpc/client";
import * as Sentry from "@sentry/react";
import { useEffect, useRef } from "react";

import { isExpectedClientError } from "#/lib/client-error-reporting";
import type { MessageListItem } from "#/lib/mail";
import { rpc } from "#/lib/orpc";
import {
  isGmailSandboxMailboxId,
  isManagedSandboxMailboxId,
} from "#/lib/sandbox-mailbox";

export const useBriefMailboxActivity = (
  sources: readonly {
    mailboxId: string;
    message?: Pick<MessageListItem, "receivedAt" | "internalDate">;
  }[],
  enabled = true
) => {
  const lastRecordedAt = useRef(new Map<string, number>());

  useEffect(() => {
    if (!enabled || document.visibilityState !== "visible") {
      return;
    }
    const now = Date.now();
    const recordActivity = async (mailboxId: string) => {
      try {
        await rpc.dailyBrief.activity({
          mailboxId,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
      } catch (error) {
        if (
          !isExpectedClientError(error) &&
          !(error instanceof ORPCError && error.status < 500)
        ) {
          Sentry.captureException(error, {
            tags: { boundary: "brief-mailbox-activity" },
          });
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
        now - (lastRecordedAt.current.get(mailboxId) ?? 0) < 3_600_000
      ) {
        continue;
      }
      lastRecordedAt.current.set(mailboxId, now);
      void recordActivity(mailboxId);
    }
  }, [enabled, sources]);
};
