import { useCallback, useEffect, useRef, useState } from "react";

export type AudioRecorderRecording = {
  base64: string;
  blob: Blob;
  durationMs: number;
  mimeType: string;
};

type UseAudioRecorderOptions = {
  mimeType: string;
};

const blobToBase64 = async (blob: Blob) => {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x80_00;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCodePoint(
      ...bytes.subarray(offset, offset + chunkSize)
    );
  }
  return btoa(binary);
};

const stopStreamTracks = (stream: MediaStream) => {
  for (const track of stream.getTracks()) {
    track.stop();
  }
};

/**
 * Minimal MediaRecorder wrapper for push-to-talk capture. Recording stops
 * when the caller invokes stop(), which resolves with the encoded clip.
 */
export const useAudioRecorder = (options: UseAudioRecorderOptions) => {
  const { mimeType } = options;
  const [isRecording, setIsRecording] = useState(false);
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

  const isSupported =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    MediaRecorder.isTypeSupported(mimeType);

  const start = useCallback(async () => {
    if (!isSupported || isRecording || startingRef.current) {
      throw new Error("Audio recording is unavailable.");
    }
    startingRef.current = true;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (unmountedRef.current) {
        stopStreamTracks(stream);
        throw new Error("Audio recording is unavailable.");
      }
      activeStreamRef.current = stream;
      const ownedStream = stream;
      const recorder = new MediaRecorder(ownedStream, { mimeType });
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
      if (stream !== null && activeStreamRef.current !== stream) {
        stopStreamTracks(stream);
      }
      throw error;
    } finally {
      startingRef.current = false;
    }
  }, [isRecording, isSupported, mimeType]);

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
    const blob = new Blob(chunks, { type: mimeType });
    return { base64: await blobToBase64(blob), blob, durationMs, mimeType };
  }, [isRecording, mimeType]);

  return { isRecording, isSupported, start, stop };
};
