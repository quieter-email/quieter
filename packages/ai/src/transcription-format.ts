import { z } from "zod";

export const OPENROUTER_TRANSCRIPTION_MODEL = "openai/gpt-4o-mini-transcribe" as const;

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
