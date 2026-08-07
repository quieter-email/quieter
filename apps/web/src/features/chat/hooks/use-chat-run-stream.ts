"use client";

import type { ChatMessagePart } from "@quieter/database/schema";
import { useEffect, useRef } from "react";
import {
  ChatRunStreamError,
  consumeChatRunStream,
  type ChatRunStreamDone,
} from "../lib/chat-run-stream";

export type { ChatRunStreamDone };

const waitForRetry = (attempt: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const finish = () => {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = window.setTimeout(finish, Math.min(1_000 * 2 ** attempt, 5_000));
    signal.addEventListener("abort", finish, { once: true });
  });

export const useChatRunStream = ({
  assistantMessageId,
  enabled,
  onDone,
  onDraft,
  onError,
  runId,
}: {
  assistantMessageId: string | null;
  enabled: boolean;
  onDone: (result: ChatRunStreamDone) => void;
  onDraft: (input: { assistantMessageId: string; parts: ChatMessagePart[] }) => void;
  onError: (message: string) => void;
  runId: string | null;
}) => {
  const onDoneRef = useRef(onDone);
  const onDraftRef = useRef(onDraft);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onDoneRef.current = onDone;
    onDraftRef.current = onDraft;
    onErrorRef.current = onError;
  }, [onDone, onDraft, onError]);

  useEffect(() => {
    if (!enabled || !runId || !assistantMessageId) {
      return;
    }

    const activeAssistantMessageId = assistantMessageId;
    const controller = new AbortController();

    void (async () => {
      let attempt = 0;

      while (!controller.signal.aborted) {
        try {
          const result = await consumeChatRunStream({
            assistantMessageId: activeAssistantMessageId,
            onDraft: (draft) => onDraftRef.current(draft),
            runId,
            signal: controller.signal,
          });
          if (!controller.signal.aborted) {
            onDoneRef.current(result);
          }
          return;
        } catch (error) {
          if (controller.signal.aborted) {
            return;
          }

          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }

          if (!(error instanceof ChatRunStreamError) || error.retryable) {
            if (attempt >= 8) {
              onErrorRef.current(
                error instanceof Error && error.message
                  ? error.message
                  : "Could not open chat stream.",
              );
              return;
            }

            await waitForRetry(attempt++, controller.signal);
            continue;
          }

          onErrorRef.current(
            error instanceof Error && error.message ? error.message : "Could not open chat stream.",
          );
          return;
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [assistantMessageId, enabled, runId]);
};
