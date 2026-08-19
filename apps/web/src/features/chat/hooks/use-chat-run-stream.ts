"use client";

import type { ChatMessagePart } from "@quieter/orpc/chat-contracts";
import { useEffect, useRef } from "react";

import { consumeChatRunStream } from "../lib/chat-run-stream";
import type { ChatRunStreamDone as ChatRunStreamDoneType } from "../lib/chat-run-stream";

export type { ChatRunStreamDone } from "../lib/chat-run-stream";
type ChatRunStreamDone = ChatRunStreamDoneType;

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
      try {
        // Reconnects are handled inside `consumeChatRunStream` with a single bounded
        // backoff budget; this hook only awaits the terminal result.
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
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        onErrorRef.current(
          error instanceof Error && error.message
            ? error.message
            : "Could not open chat stream."
        );
      }
    })();

    return () => {
      controller.abort();
    };
    // initialParts are read from a ref so reconnects keep the freshest draft without
    // tearing down the SSE when parts update every token.
  }, [assistantMessageId, enabled, runId]);
};
