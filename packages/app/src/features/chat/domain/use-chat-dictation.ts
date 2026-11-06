import { USER_BILLING_QUERY_KEY } from "@quieter/app/features/settings/domain/billing";
import { useAudioRecorder } from "@quieter/app/lib/audio-recorder";
import {
  MAX_TRANSCRIPTION_AUDIO_DURATION_MS,
  prepareTranscriptionRecording,
} from "@quieter/app/lib/audio-transcription";
import { toastError } from "@quieter/app/lib/error-toast";
import { orpc, rpc } from "@quieter/app/lib/orpc";
import type { RouterInputs } from "@quieter/orpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

type DictationSession = {
  controller: AbortController;
  phase: "starting" | "recording" | "transcribing";
};

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
  const {
    analyser,
    cancel: cancelRecording,
    isRecording,
    isSupported,
    start,
    stop,
  } = useAudioRecorder();
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
  const session = useRef<DictationSession | null>(null);
  const latest = useRef(onTranscript);
  useLayoutEffect(() => {
    latest.current = onTranscript;
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const cancel = useCallback(() => {
    const { current } = session;
    session.current = null;
    current?.controller.abort();
    cancelRecording();
    if (mounted.current) {
      setPhase("idle");
    }
  }, [cancelRecording]);
  useLayoutEffect(
    () => () => {
      cancel();
    },
    [cancel, chatId, enabled, mailboxId]
  );

  const finish = useCallback(async () => {
    const { current } = session;
    if (
      current?.phase !== "recording" ||
      !isRecording ||
      current.controller.signal.aborted
    ) {
      return;
    }
    current.phase = "transcribing";
    setPhase("transcribing");
    try {
      const clip = await stop();
      if (!mounted.current || current.controller.signal.aborted) {
        return;
      }
      const recording = await prepareTranscriptionRecording(clip);
      if (!mounted.current || current.controller.signal.aborted) {
        return;
      }
      const result = await mutateAsync({
        input: {
          ...recording,
          ...(chatId === null ? {} : { chatId }),
          mailboxId,
          mode: "chat",
        },
        signal: current.controller.signal,
      });
      if (mounted.current && !current.controller.signal.aborted) {
        latest.current(result.text);
      }
    } catch (error) {
      if (mounted.current && !current.controller.signal.aborted) {
        toastError(error, { boundary: "assistant-dictation" });
      }
    } finally {
      if (session.current === current) {
        session.current = null;
        if (mounted.current) {
          setPhase("idle");
        }
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

  const toggle = async () => {
    if (!enabled) {
      return;
    }
    if (session.current?.phase === "recording") {
      if (isRecording) {
        await finish();
        return;
      }
      cancel();
    }
    if (session.current !== null) {
      return;
    }
    const current: DictationSession = {
      controller: new AbortController(),
      phase: "starting",
    };
    session.current = current;
    setPhase("starting");
    try {
      await start();
      if (session.current === current) {
        current.phase = "recording";
        setPhase("idle");
      }
    } catch (error) {
      if (mounted.current && !current.controller.signal.aborted) {
        toastError(error, { boundary: "assistant-microphone" });
      }
      if (session.current === current) {
        session.current = null;
        if (mounted.current) {
          setPhase("idle");
        }
      }
    }
  };

  return {
    analyser,
    cancel,
    isRecording,
    isStarting: phase === "starting",
    isSupported,
    isTranscribing: phase === "transcribing",
    toggle,
  };
};
