import { serverEnv } from "@quieter/env/server";
import { z } from "zod";

import { OPENROUTER_TRANSCRIPTION_MODEL } from "./transcription-format";
import type { OpenRouterAudioFormat } from "./transcription-format";

const OPENROUTER_TRANSCRIPTION_TIMEOUT_MS = 60_000;

export type OpenRouterTranscriptionUsage = {
  completionTokens: number;
  cost: number | undefined;
  durationSeconds: number | undefined;
  promptTokens: number;
};

const getTranscriptionRequestError = (status: number) => {
  if (status === 400 || status === 422) {
    return "We could not transcribe that recording. Try speaking more clearly or recording again.";
  }

  if (status === 413) {
    return "Transcription recordings must be 60 seconds or shorter.";
  }

  if (status === 429) {
    return "Transcription is busy right now. Try again in a moment.";
  }

  return "Transcription is temporarily unavailable. Try again in a moment.";
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

const isTranscriptionTimeoutError = (error: unknown) =>
  (error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")) ||
  (error instanceof Error && /timed?\s*out|timeout/iu.test(error.message));

/**
 * Transcribes audio through OpenRouter's transcription endpoint and returns
 * the text plus usage for billing.
 */
export const generateOpenRouterTranscription = async (input: {
  audioBase64: string;
  format: OpenRouterAudioFormat;
}): Promise<{ text: string; usage: OpenRouterTranscriptionUsage }> => {
  const apiKey = serverEnv.OPENROUTER_API_KEY;

  if (apiKey === undefined || apiKey === "") {
    throw new Error("AI features are temporarily unavailable.");
  }

  try {
    // The browser transport may send a data URL; only the payload after the
    // comma is valid base64 audio data.
    const { audioBase64 } = input;
    const response = await fetch(
      "https://openrouter.ai/api/v1/audio/transcriptions",
      {
        body: JSON.stringify({
          input_audio: {
            data: audioBase64.includes(",")
              ? audioBase64.slice(audioBase64.indexOf(",") + 1)
              : audioBase64,
            format: input.format,
          },
          model: OPENROUTER_TRANSCRIPTION_MODEL,
        }),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://quieter.email",
          "X-Title": "quieter",
        },
        method: "POST",
        signal: AbortSignal.timeout(OPENROUTER_TRANSCRIPTION_TIMEOUT_MS),
      }
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(getTranscriptionRequestError(response.status), {
        cause: { detail, status: response.status },
      });
    }

    const result = openRouterTranscriptionResponseSchema.parse(
      await response.json()
    );
    return {
      text: result.text,
      usage: {
        completionTokens: result.usage?.output_tokens ?? 0,
        cost: result.usage?.cost,
        durationSeconds: result.usage?.seconds,
        promptTokens: result.usage?.input_tokens ?? 0,
      },
    };
  } catch (error: unknown) {
    if (isTranscriptionTimeoutError(error)) {
      throw new Error("Transcription took too long. Try a shorter recording.", {
        cause: error,
      });
    }

    throw error;
  }
};
