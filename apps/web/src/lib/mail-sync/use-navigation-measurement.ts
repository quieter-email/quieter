import type { ThreadMessagesResult } from "@quieter/mail/messages";
import { useEffect, useLayoutEffect, useRef } from "react";

import { hasRenderableMessageBody } from "#/lib/mail";

import { recordMailSyncMeasurement } from "./measurements";

export const useMailNavigationMeasurement = (
  mailboxId: string,
  threadId: string,
  cached: ThreadMessagesResult | undefined,
  current: ThreadMessagesResult | undefined
) => {
  const key = `${mailboxId}:${threadId}`;
  const navigation = useRef<{
    key: string;
    started: number;
    prepared: boolean;
    recorded: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    if (navigation.current?.key !== key) {
      navigation.current = {
        key,
        prepared:
          cached !== undefined &&
          cached.messages.length > 0 &&
          cached.messages.every(hasRenderableMessageBody),
        recorded: false,
        started: performance.now(),
      };
    }
  }, [cached, key]);
  useEffect((): (() => void) | undefined => {
    const visit = navigation.current;
    if (
      visit === null ||
      visit.recorded ||
      document.hidden ||
      current === undefined ||
      current.messages.length === 0 ||
      !current.messages.every(hasRenderableMessageBody)
    ) {
      return undefined;
    }
    const frame = requestAnimationFrame(() => {
      if (navigation.current !== visit || document.hidden) {
        return;
      }
      visit.recorded = true;
      recordMailSyncMeasurement("navigation-prepared", Number(visit.prepared));
      recordMailSyncMeasurement(
        "navigation-ready-ms",
        performance.now() - visit.started
      );
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [current, key]);
};
