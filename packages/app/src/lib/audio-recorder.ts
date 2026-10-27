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

/**
 * Minimal MediaRecorder wrapper for push-to-talk capture. Recording stops
 * when the caller invokes stop(), which resolves with the encoded clip.
 */
export const useAudioRecorder = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  // Set synchronously while a start() call is between its availability check
  // and ownership of the recorder, so concurrent calls cannot both acquire a
  // stream while awaiting getUserMedia.
  const startingRef = useRef(false);
  // Tracks whether getUserMedia resolved for an unmounted component, so the
  // late stream is stopped immediately instead of keeping the mic hot.
  const unmountedRef = useRef(false);
  const activeStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder !== null && recorder.state !== "inactive") {
        recorder.stop();
      }
      const stream = activeStreamRef.current;
      activeStreamRef.current = null;
      if (stream !== null) {
        stopStreamTracks(stream);
      }
    };
  }, []);

  const preferredMimeType =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
      ? recordingMimeTypes.find((type) => MediaRecorder.isTypeSupported(type))
      : undefined;
  const isSupported = preferredMimeType !== undefined;

  const start = useCallback(async () => {
    if (isRecording || recorderRef.current !== null || startingRef.current) {
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
    startingRef.current = true;
    setIsStarting(true);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (unmountedRef.current) {
        stopStreamTracks(stream);
        throw new Error("Audio recording is unavailable.");
      }
      activeStreamRef.current = stream;
      const ownedStream = stream;
      const recorder = new MediaRecorder(ownedStream, {
        mimeType: preferredMimeType,
      });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        stopStreamTracks(ownedStream);
        activeStreamRef.current = null;
        setIsRecording(false);
      };
      recorder.addEventListener("error", () => {
        toastError(new Error("Audio recording failed."), {
          boundary: "audio-recorder",
        });
        stopStreamTracks(ownedStream);
        activeStreamRef.current = null;
        setIsRecording(false);
        recorderRef.current = null;
      });
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.start();
      setIsRecording(true);
    } catch (error) {
      // A failed attempt releases everything it claimed, even when the stream
      // was already registered as active before setup threw.
      if (stream !== null) {
        if (activeStreamRef.current === stream) {
          activeStreamRef.current = null;
        }
        if (
          recorderRef.current !== null &&
          recorderRef.current.stream === stream
        ) {
          recorderRef.current = null;
        }
        stopStreamTracks(stream);
      }
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
    } finally {
      startingRef.current = false;
      if (!unmountedRef.current) {
        setIsStarting(false);
      }
    }
  }, [isRecording, preferredMimeType]);

  const stop = useCallback(async (): Promise<AudioRecorderRecording> => {
    const recorder = recorderRef.current;
    if (recorder === null || !isRecording) {
      throw new Error("No recording is active.");
    }
    const durationMs = Date.now() - startedAtRef.current;
    const chunks = chunksRef.current;
    // Waiting for the stop event is the only way to know the encoder flushed
    // its final chunk before the blob is assembled.
    // oxlint-disable-next-line promise/avoid-new
    const finished = new Promise<void>((resolve) => {
      const previousOnStop = recorder.onstop;
      recorder.onstop = (event) => {
        previousOnStop?.call(recorder, event);
        resolve();
      };
    });
    recorder.stop();
    recorderRef.current = null;
    await finished;
    const mimeType =
      recorder.mimeType || chunks.find((chunk) => chunk.type.length > 0)?.type;
    if (!mimeType) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This audio format is not supported.",
      });
    }
    const blob = new Blob(chunks, { type: mimeType });
    return { blob, durationMs, mimeType };
  }, [isRecording]);

  return { isRecording, isStarting, isSupported, start, stop };
};
