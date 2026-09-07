import { ORPCError } from "@orpc/client";
import type { RouterInputs } from "@quieter/orpc";

import type { AudioRecorderRecording } from "./audio-recorder";

export type TranscriptionAudioFormat =
  RouterInputs["chat"]["transcribeAudio"]["format"];

export const MAX_TRANSCRIPTION_AUDIO_DURATION_MS = 60_000;
export const MAX_TRANSCRIPTION_AUDIO_BASE64_LENGTH = 14_000_000;

export const getTranscriptionAudioFormat = (
  mimeType: string
): TranscriptionAudioFormat | null => {
  const [type] = mimeType.toLowerCase().split(";");

  switch (type) {
    case "audio/aac": {
      return "aac";
    }
    case "audio/flac": {
      return "flac";
    }
    case "audio/mp4":
    case "audio/x-m4a": {
      return "m4a";
    }
    case "audio/mpeg":
    case "audio/mp3": {
      return "mp3";
    }
    case "audio/ogg": {
      return "ogg";
    }
    case "audio/wav":
    case "audio/wave":
    case "audio/x-wav": {
      return "wav";
    }
    case "audio/webm": {
      return "webm";
    }
    default: {
      return null;
    }
  }
};

export const encodePcmWav = (channels: Float32Array[], sampleRate: number) => {
  const sampleCount = channels[0]?.length ?? 0;
  const bytes = new Uint8Array(44 + sampleCount * 2);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.codePointAt(index) ?? 0);
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, sampleCount * 2, true);

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.max(
      -1,
      Math.min(
        1,
        channels.reduce((sum, channel) => sum + (channel[index] ?? 0), 0) /
          Math.max(1, channels.length)
      )
    );
    view.setInt16(
      44 + index * 2,
      sample < 0 ? sample * 0x80_00 : sample * 0x7f_ff,
      true
    );
  }

  return bytes;
};

export const prepareTranscriptionRecording = async (
  recording: AudioRecorderRecording
) => {
  if (recording.durationMs > MAX_TRANSCRIPTION_AUDIO_DURATION_MS) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Recordings must be 60 seconds or shorter.",
    });
  }
  let format = getTranscriptionAudioFormat(recording.mimeType);
  if (format === null) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This audio format is not supported.",
    });
  }
  if (
    Math.ceil(recording.blob.size / 3) * 4 >
    MAX_TRANSCRIPTION_AUDIO_BASE64_LENGTH
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This recording is too large to transcribe.",
    });
  }
  let bytes = new Uint8Array(await recording.blob.arrayBuffer());
  // The configured transcription model rejects these containers, including the browser's WebM output.
  if (format === "webm" || format === "m4a" || format === "aac") {
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(bytes.buffer);
      bytes = encodePcmWav(
        Array.from({ length: decoded.numberOfChannels }, (_, index) =>
          decoded.getChannelData(index)
        ),
        decoded.sampleRate
      );
      format = "wav";
    } finally {
      await context.close();
    }
  }
  if (Math.ceil(bytes.length / 3) * 4 > MAX_TRANSCRIPTION_AUDIO_BASE64_LENGTH) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This recording is too large to transcribe.",
    });
  }
  return {
    audioBase64: bytes.toBase64(),
    durationMs: recording.durationMs,
    format,
  };
};
