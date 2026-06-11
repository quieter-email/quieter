"use client";

import type { ChatMessagePart, ChatRunStatus } from "@quieter/database";
import { useEffect, useRef } from "react";
import { ChatRunStreamError, consumeChatRunStream } from "../lib/chat-run-stream";

export type ChatRunStreamDone = {
  assistantMessageId: string;
  error?: string | null;
  parts: ChatMessagePart[];
  status: ChatRunStatus;
};

const waitForRetry = (attempt: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = window.setTimeout(finish, Math.min(1_000 * 2 ** attempt, 5_000));
    signal.addEventListener("abort", finish, { once: true });
  });

export const useChatRunStream = ({
  enabled,
  onDone,
  onDraft,
  onError,
  runId,
}: {
  enabled: boolean;
  onDone: (result: ChatRunStreamDone) => void;
  onDraft: (input: { assistantMessageId: string; parts: ChatMessagePart[] }) => void;
  onError: (message: string) => void;
  runId: string | null;
}) => {
  const assistantMessageIdRef = useRef<string | null>(null);
  const onDoneRef = useRef(onDone);
  const onDraftRef = useRef(onDraft);
  const onErrorRef = useRef(onError);

  onDoneRef.current = onDone;
  onDraftRef.current = onDraft;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!enabled || !runId) {
      return;
    }

    const controller = new AbortController();

    void (async () => {
      let attempt = 0;

      while (!controller.signal.aborted) {
        try {
          await consumeChatRunStream({
            onEvent: (event) => {
              if (event.type === "draft") {
                assistantMessageIdRef.current = event.assistantMessageId;
                onDraftRef.current({
                  assistantMessageId: event.assistantMessageId,
                  parts: event.parts,
                });
                return;
              }

              if (event.type === "done") {
                onDoneRef.current({
                  assistantMessageId:
                    event.assistantMessageId || assistantMessageIdRef.current || "",
                  error: event.error,
                  parts: event.parts,
                  status: event.status,
                });
              }
            },
            runId,
            signal: controller.signal,
          });
          return;
        } catch (error) {
          if (controller.signal.aborted) {
            return;
          }

          if (error instanceof ChatRunStreamError && error.retryable) {
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
  }, [enabled, runId]);
};
