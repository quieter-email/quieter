"use client";

import type { ChatMessagePart } from "@quieter/database";
import { useEffect, useRef } from "react";
import { consumeChatRunStream } from "../lib/chat-run-stream";

export type ChatRunStreamDone = {
  assistantMessageId: string;
  error?: string | null;
  parts: ChatMessagePart[];
  status: string;
};

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
              if (event.error) {
                onErrorRef.current(event.error);
              }

              onDoneRef.current({
                assistantMessageId: event.assistantMessageId || assistantMessageIdRef.current || "",
                error: event.error,
                parts: event.parts,
                status: event.status,
              });
            }
          },
          runId,
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        onErrorRef.current(
          error instanceof Error && error.message ? error.message : "Chat stream disconnected.",
        );
      }
    })();

    return () => {
      controller.abort();
    };
  }, [enabled, runId]);
};
