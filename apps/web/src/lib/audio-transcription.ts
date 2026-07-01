import type { RouterInputs } from "@quieter/orpc";

export type TranscriptionAudioFormat = RouterInputs["chat"]["transcribeAudio"]["format"];

export type BrowserAudioRecording = {
  base64: string;
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
