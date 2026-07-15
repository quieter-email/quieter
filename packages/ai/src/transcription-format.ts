import { z } from "zod";

export const OPENROUTER_TRANSCRIPTION_MODEL = "microsoft/mai-transcribe-1.5" as const;

export const openRouterAudioFormatSchema = z.enum([
  "wav",
  "mp3",
  "flac",
  "m4a",
  "ogg",
  "webm",
  "aac",
]);

export type OpenRouterAudioFormat = z.infer<typeof openRouterAudioFormatSchema>;
