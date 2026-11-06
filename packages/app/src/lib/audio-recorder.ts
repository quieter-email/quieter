import { ORPCError } from "@orpc/client";
import { toastError } from "@quieter/app/lib/error-toast";
import { useCallback, useEffect, useRef, useState } from "react";

export type AudioRecorderRecording = {
  blob: Blob;
  durationMs: number;
  mimeType: string;
};

const recordingMimeTypes = [
  "audio/webm;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/ogg;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
];

const stopStreamTracks = (stream: MediaStream) => {
  for (const track of stream.getTracks()) {
    track.stop();
  }
};

type RecordingSession = {
  kind: "recording" | "stopping" | "cancelled";
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  startedAt: number;
  meter: {
    context: AudioContext;
    source: MediaStreamAudioSourceNode;
    analyser: AnalyserNode;
  } | null;
  completion: {
    resolve: (recording: AudioRecorderRecording) => void;
    reject: (error: Error) => void;
  } | null;
};

type RecorderSession = { kind: "starting" } | RecordingSession;

const closeAudioContext = async (context: AudioContext) => {
  if (context.state === "closed") {
    return;
  }
  try {
    await context.close();
  } catch (error) {
    toastError(error, { boundary: "audio-meter-close" });
  }
};

const releaseRecording = (session: RecordingSession) => {
  stopStreamTracks(session.stream);
  if (session.meter !== null) {
    session.meter.source.disconnect();
    session.meter.analyser.disconnect();
    void closeAudioContext(session.meter.context);
    session.meter = null;
  }
};

export const useAudioRecorder = () => {
  const [phase, setPhase] = useState<"idle" | "starting" | "recording">("idle");
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const sessionRef = useRef<RecorderSession | null>(null);
  const mountedRef = useRef(true);

  const cancel = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session !== null && session.kind !== "starting") {
      session.kind = "cancelled";
      session.completion?.reject(
        new DOMException("Recording cancelled.", "AbortError")
      );
      session.completion = null;
      releaseRecording(session);
      if (session.recorder.state !== "inactive") {
        session.recorder.stop();
      }
    }
    if (mountedRef.current) {
      setPhase("idle");
      setAnalyser(null);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancel();
    };
  }, [cancel]);

  const preferredMimeType =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
      ? recordingMimeTypes.find((type) => MediaRecorder.isTypeSupported(type))
      : undefined;
  const isSupported = preferredMimeType !== undefined;

  const start = useCallback(async () => {
    if (!mountedRef.current || sessionRef.current !== null) {
      return;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "Open the app using a secure connection to access your microphone.",
      });
    }
    if (preferredMimeType === undefined) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This browser cannot record audio. Try another browser.",
      });
    }
    const starting: RecorderSession = { kind: "starting" };
    sessionRef.current = starting;
    setPhase("starting");
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (sessionRef.current !== starting || !mountedRef.current) {
        stopStreamTracks(stream);
        return;
      }
      const recorder = new MediaRecorder(stream, {
        mimeType: preferredMimeType,
      });
      const session: RecordingSession = {
        chunks: [],
        completion: null,
        kind: "recording",
        meter: null,
        recorder,
        startedAt: Date.now(),
        stream,
      };
      sessionRef.current = session;
      let context: AudioContext | null = null;
      let source: MediaStreamAudioSourceNode | null = null;
      let meterAnalyser: AnalyserNode | null = null;
      try {
        context = new AudioContext();
        source = context.createMediaStreamSource(stream);
        meterAnalyser = context.createAnalyser();
        meterAnalyser.fftSize = 256;
        source.connect(meterAnalyser);
        const meter = { analyser: meterAnalyser, context, source };
        session.meter = meter;
        setAnalyser(meterAnalyser);
        void (async () => {
          try {
            await meter.context.resume();
          } catch {
            if (session.meter === meter) {
              meter.source.disconnect();
              meter.analyser.disconnect();
              void closeAudioContext(meter.context);
              session.meter = null;
              if (sessionRef.current === session) {
                setAnalyser(null);
              }
            }
          }
        })();
      } catch {
        source?.disconnect();
        meterAnalyser?.disconnect();
        if (context !== null) {
          void closeAudioContext(context);
        }
      }
      recorder.ondataavailable = (event) => {
        if (session.kind !== "cancelled" && event.data.size > 0) {
          session.chunks.push(event.data);
        }
      };
      recorder.onstop = () => {
        releaseRecording(session);
        if (sessionRef.current === session) {
          sessionRef.current = null;
          setPhase("idle");
          setAnalyser(null);
        }
        const { completion } = session;
        session.completion = null;
        if (completion === null || session.kind === "cancelled") {
          return;
        }
        const mimeType =
          recorder.mimeType ||
          session.chunks.find((chunk) => chunk.type.length > 0)?.type;
        if (!mimeType) {
          completion.reject(
            new ORPCError("BAD_REQUEST", {
              message: "This audio format is not supported.",
            })
          );
          return;
        }
        completion.resolve({
          blob: new Blob(session.chunks, { type: mimeType }),
          durationMs: Date.now() - session.startedAt,
          mimeType,
        });
      };
      recorder.addEventListener("error", () => {
        const error = new Error("Audio recording failed.");
        const { completion } = session;
        completion?.reject(error);
        session.completion = null;
        if (sessionRef.current === session) {
          cancel();
          if (completion === null) {
            toastError(error, { boundary: "audio-recorder" });
          }
        } else {
          releaseRecording(session);
        }
      });
      recorder.start();
      setPhase("recording");
    } catch (error) {
      if (stream !== null) {
        stopStreamTracks(stream);
      }
      const { current } = sessionRef;
      if (
        current !== starting &&
        (current === null ||
          current.kind === "starting" ||
          current.stream !== stream)
      ) {
        return;
      }
      cancel();
      if (error instanceof DOMException) {
        let message: string | undefined;
        switch (error.name) {
          case "NotAllowedError":
          case "SecurityError": {
            message =
              "Allow microphone access in your browser and device settings, then try again.";
            break;
          }
          case "NotFoundError": {
            message = "Connect or enable a microphone, then try again.";
            break;
          }
          case "NotReadableError": {
            message =
              "Check your microphone and close other apps using it, then try again.";
            break;
          }
          case "AbortError": {
            message = "Microphone startup was interrupted. Please try again.";
            break;
          }
          case "NotSupportedError": {
            message = "This browser cannot record audio. Try another browser.";
            break;
          }
          default: {
            break;
          }
        }
        if (message !== undefined) {
          throw new ORPCError("BAD_REQUEST", { message });
        }
      }
      throw error;
    }
  }, [cancel, preferredMimeType]);

  const stop = useCallback(async (): Promise<AudioRecorderRecording> => {
    const session = sessionRef.current;
    if (session === null || session.kind !== "recording") {
      throw new Error("No recording is active.");
    }
    session.kind = "stopping";
    setPhase("idle");
    setAnalyser(null);
    // The stop event follows the encoder's final data event.
    // oxlint-disable-next-line promise/avoid-new
    return await new Promise((resolve, reject) => {
      session.completion = { reject, resolve };
      try {
        session.recorder.stop();
        releaseRecording(session);
      } catch (error) {
        session.completion = null;
        cancel();
        reject(
          error instanceof Error
            ? error
            : new Error("Audio recording failed.", { cause: error })
        );
      }
    });
  }, [cancel]);

  return {
    analyser,
    cancel,
    isRecording: phase === "recording",
    isStarting: phase === "starting",
    isSupported,
    start,
    stop,
  };
};
