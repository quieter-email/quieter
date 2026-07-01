import { serverEnv } from "@quieter/env/server";
import { generateTranscription, type TranscriptionAdapter } from "@tanstack/ai";
import { Buffer } from "node:buffer";
import { z } from "zod";
import { OPENROUTER_TRANSCRIPTION_MODEL, type OpenRouterAudioFormat } from "./transcription-format";

type OpenRouterTranscriptionOptions = {
  format: OpenRouterAudioFormat;
};

const openRouterTranscriptionResponseSchema = z.object({
  text: z.string(),
  usage: z
    .object({
      cost: z.number().optional(),
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      seconds: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});

const getBase64Audio = async (audio: string | File | Blob | ArrayBuffer) => {
  if (typeof audio === "string") {
    return audio.includes(",") ? audio.slice(audio.indexOf(",") + 1) : audio;
  }

  if (audio instanceof ArrayBuffer) {
    return Buffer.from(audio).toString("base64");
  }

  return Buffer.from(await audio.arrayBuffer()).toString("base64");
};

export const createOpenRouterTranscriptionAdapter = (
  model = OPENROUTER_TRANSCRIPTION_MODEL,
): TranscriptionAdapter<typeof model, OpenRouterTranscriptionOptions> => {
  const apiKey = serverEnv.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("AI features are temporarily unavailable.");
  }

  return {
    "~types": undefined as never,
    kind: "transcription",
    model,
    name: "openrouter",
    transcribe: async (options) => {
      options.logger.request("activity=transcription provider=openrouter", {
        format: options.modelOptions?.format,
        model,
        provider: "openrouter",
      });

      try {
        const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
          body: JSON.stringify({
            input_audio: {
              data: await getBase64Audio(options.audio),
              format: options.modelOptions?.format ?? "webm",
            },
            language: options.language,
            model,
          }),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://quieter.email",
            "X-Title": "quieter",
          },
          method: "POST",
        });

        if (!response.ok) {
          throw new Error("Audio transcription is temporarily unavailable.");
        }

        const result = openRouterTranscriptionResponseSchema.parse(await response.json());
        const id = response.headers.get("x-generation-id") ?? crypto.randomUUID();
        const promptTokens = result.usage?.input_tokens ?? 0;
        const completionTokens = result.usage?.output_tokens ?? 0;

        return {
          duration: result.usage?.seconds,
          id,
          model,
          text: result.text,
          usage: {
            completionTokens,
            cost: result.usage?.cost,
            durationSeconds: result.usage?.seconds,
            promptTokens,
            totalTokens: result.usage?.total_tokens ?? promptTokens + completionTokens,
            unitsBilled: result.usage?.seconds,
          },
        };
      } catch (error) {
        options.logger.errors("transcription activity failed", {
          error,
          source: "openrouter",
        });
        throw error;
      }
    },
  };
};

export const generateOpenRouterTranscription = (input: {
  audioBase64: string;
  format: OpenRouterAudioFormat;
}) =>
  generateTranscription({
    adapter: createOpenRouterTranscriptionAdapter(),
    audio: input.audioBase64,
    modelOptions: {
      format: input.format,
    },
  });
