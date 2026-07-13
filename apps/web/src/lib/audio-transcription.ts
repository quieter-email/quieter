import type { RouterInputs } from "@quieter/orpc";

export type TranscriptionAudioFormat = RouterInputs["chat"]["transcribeAudio"]["format"];

export type BrowserAudioRecording = {
  base64: string;
  blob: Blob;
  durationMs: number;
  mimeType: string;
};

export const getTranscriptionAudioFormat = (mimeType: string): TranscriptionAudioFormat | null => {
  const [type] = mimeType.toLowerCase().split(";");

  switch (type) {
    case "audio/aac":
      return "aac";
    case "audio/flac":
      return "flac";
    case "audio/mp4":
    case "audio/x-m4a":
      return "m4a";
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/ogg":
      return "ogg";
    case "audio/wav":
    case "audio/wave":
    case "audio/x-wav":
      return "wav";
    case "audio/webm":
      return "webm";
    default:
      return null;
  }
};

export const encodePcmWav = (channels: Float32Array[], sampleRate: number) => {
  const sampleCount = channels[0]?.length ?? 0;
  const bytes = new Uint8Array(44 + sampleCount * 2);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
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
          Math.max(1, channels.length),
      ),
    );
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return bytes;
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 32_768;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
};

export const normalizeTranscriptionRecording = async (
  recording: BrowserAudioRecording,
): Promise<BrowserAudioRecording> => {
  if (getTranscriptionAudioFormat(recording.mimeType) === "wav") {
    return recording;
  }

  const audioContext = new AudioContext();

  try {
    const decoded = await audioContext.decodeAudioData(await recording.blob.arrayBuffer());
    const bytes = encodePcmWav(
      Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index)),
      decoded.sampleRate,
    );
    const blob = new Blob([bytes], { type: "audio/wav" });

    return {
      base64: bytesToBase64(bytes),
      blob,
      durationMs: recording.durationMs,
      mimeType: blob.type,
    };
  } finally {
    await audioContext.close();
  }
};
