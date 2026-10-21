import { ORPCError } from "@orpc/client";
import type { RouterInputs } from "@quieter/orpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { USER_BILLING_QUERY_KEY } from "#/features/settings/domain/billing";
import { useAudioRecorder } from "#/lib/audio-recorder";
import {
  MAX_TRANSCRIPTION_AUDIO_DURATION_MS,
  prepareTranscriptionRecording,
} from "#/lib/audio-transcription";
import { toastError } from "#/lib/error-toast";
import { orpc, rpc } from "#/lib/orpc";

export const useChatDictation = ({
  chatId,
  enabled,
  mailboxId,
  onTranscript,
}: {
  chatId: string | null;
  enabled: boolean;
  mailboxId: string;
  onTranscript: (text: string) => void;
}) => {
  const { isRecording, isSupported, start, stop } = useAudioRecorder({
    mimeType: "audio/webm;codecs=opus",
  });
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationFn: async ({
      input,
      signal,
    }: {
      input: RouterInputs["chat"]["transcribeAudio"];
      signal: AbortSignal;
    }) => await rpc.chat.transcribeAudio(input, { signal }),
    mutationKey: [
      ...orpc.chat.transcribeAudio.mutationKey(),
      mailboxId,
      chatId,
    ],
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY });
    },
  });
  const [phase, setPhase] = useState<"idle" | "starting" | "transcribing">(
    "idle"
  );
  const mounted = useRef(true);
  const pending = useRef(false);
  const session = useRef<AbortController | null>(null);
  const latest = useRef(onTranscript);
  useLayoutEffect(() => {
    latest.current = onTranscript;
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      session.current?.abort();
    };
  }, []);
  useLayoutEffect(
    () => () => {
      session.current?.abort();
    },
    [chatId, enabled, mailboxId]
  );

  const finish = useCallback(async () => {
    const currentSession = session.current;
    if (
      pending.current ||
      !isRecording ||
      currentSession === null ||
      currentSession.signal.aborted
    ) {
      return;
    }
    pending.current = true;
    setPhase("transcribing");
    try {
      const clip = await stop();
      if (!mounted.current || currentSession.signal.aborted) {
        return;
      }
      const recording = await prepareTranscriptionRecording(clip);
      if (!mounted.current || currentSession.signal.aborted) {
        return;
      }
      const result = await mutateAsync({
        input: {
          ...recording,
          ...(chatId === null ? {} : { chatId }),
          mailboxId,
          mode: "chat",
        },
        signal: currentSession.signal,
      });
      if (mounted.current && !currentSession.signal.aborted) {
        latest.current(result.text);
      }
    } catch (error) {
      if (mounted.current && !currentSession.signal.aborted) {
        toastError(error, { boundary: "assistant-dictation" });
      }
    } finally {
      pending.current = false;
      session.current = null;
      if (mounted.current) {
        setPhase("idle");
      }
    }
  }, [chatId, isRecording, mailboxId, mutateAsync, stop]);
  const finishRef = useRef(finish);
  useLayoutEffect(() => {
    finishRef.current = finish;
  }, [finish]);
  useEffect(() => {
    const timer = isRecording
      ? window.setTimeout(() => {
          void finishRef.current();
        }, MAX_TRANSCRIPTION_AUDIO_DURATION_MS - 500)
      : undefined;
    return () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [isRecording]);
  useEffect(() => {
    if (
      !isRecording ||
      phase !== "idle" ||
      pending.current ||
      (enabled && session.current?.signal.aborted === false)
    ) {
      return;
    }
    const discard = async () => {
      pending.current = true;
      try {
        await stop();
      } catch (error) {
        if (mounted.current) {
          toastError(error, { boundary: "assistant-dictation-stop" });
        }
      } finally {
        pending.current = false;
        session.current = null;
        if (mounted.current) {
          setPhase("idle");
        }
      }
    };
    void discard();
  }, [chatId, enabled, isRecording, mailboxId, phase, stop]);

  const toggle = async () => {
    if (!enabled || pending.current) {
      return;
    }
    if (isRecording) {
      await finish();
      return;
    }
    pending.current = true;
    const currentSession = new AbortController();
    session.current = currentSession;
    setPhase("starting");
    try {
      await start();
    } catch (error) {
      if (mounted.current && !currentSession.signal.aborted) {
        toastError(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? new ORPCError("BAD_REQUEST", {
                message: "Allow microphone access in your browser to dictate.",
              })
            : error,
          { boundary: "assistant-microphone" }
        );
      }
    } finally {
      pending.current = false;
      if (mounted.current) {
        setPhase("idle");
      }
    }
  };

  return {
    isRecording,
    isStarting: phase === "starting",
    isSupported,
    isTranscribing: phase === "transcribing",
    toggle,
  };
};
