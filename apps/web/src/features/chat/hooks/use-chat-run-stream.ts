"use client";

import type { ChatMessagePart } from "@quieter/database/schema";
import { useEffect, useRef } from "react";

import {
  ChatRunStreamError,
  consumeChatRunStream,
} from "../lib/chat-run-stream";
import type { ChatRunStreamDone as ChatRunStreamDoneType } from "../lib/chat-run-stream";

export type { ChatRunStreamDone } from "../lib/chat-run-stream";
type ChatRunStreamDone = ChatRunStreamDoneType;

const waitForRetry = async (attempt: number, signal: AbortSignal) => {
  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    let timeout = 0;
    const finish = () => {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    timeout = window.setTimeout(finish, Math.min(1000 * 2 ** attempt, 5000));
    signal.addEventListener("abort", finish, { once: true });
  });
};

export const useChatRunStream = ({
  assistantMessageId,
  enabled,
  initialParts,
  onDone,
  onDraft,
  onError,
  runId,
}: {
  assistantMessageId: string | null;
  enabled: boolean;
  /** Latest known assistant parts to paint before tailing live tokens. */
  initialParts?: ChatMessagePart[];
  onDone: (result: ChatRunStreamDone) => void;
  onDraft: (input: {
    assistantMessageId: string;
    parts: ChatMessagePart[];
  }) => void;
  onError: (message: string) => void;
  runId: string | null;
}) => {
  const onDoneRef = useRef(onDone);
  const onDraftRef = useRef(onDraft);
  const onErrorRef = useRef(onError);
  const initialPartsRef = useRef(initialParts);

  useEffect(() => {
    onDoneRef.current = onDone;
    onDraftRef.current = onDraft;
    onErrorRef.current = onError;
  }, [onDone, onDraft, onError]);

  useEffect(() => {
    initialPartsRef.current = initialParts;
  }, [initialParts]);

  useEffect((): (() => void) | undefined => {
    if (
      !enabled ||
      runId === null ||
      runId === undefined ||
      runId === "" ||
      assistantMessageId === null ||
      assistantMessageId === undefined ||
      assistantMessageId === ""
    ) {
      return undefined;
    }

    const activeAssistantMessageId = assistantMessageId;
    const controller = new AbortController();

    void (async () => {
      let attempt = 0;

      while (!controller.signal.aborted) {
        try {
          // Reconnect attempts must remain sequential so backoff is honored.
          // oxlint-disable-next-line eslint/no-await-in-loop
          const result = await consumeChatRunStream({
            assistantMessageId: activeAssistantMessageId,
            initialParts: initialPartsRef.current,
            onDraft: (draft) => {
              onDraftRef.current(draft);
            },
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
                  : "Could not open chat stream."
              );
              return;
            }

            const retryAttempt = attempt;
            attempt += 1;
            // Retries must wait for the previous backoff before reconnecting.
            // oxlint-disable-next-line eslint/no-await-in-loop
            await waitForRetry(retryAttempt, controller.signal);
            continue;
          }

          onErrorRef.current(
            error instanceof Error && error.message
              ? error.message
              : "Could not open chat stream."
          );
          return;
        }
      }
    })();

    return () => {
      controller.abort();
    };
    // initialParts are read from a ref so reconnects keep the freshest draft without
    // tearing down the SSE when parts update every token.
  }, [assistantMessageId, enabled, runId]);
};
