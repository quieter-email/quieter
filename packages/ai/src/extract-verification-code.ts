import type { AiBillingContext } from "@quieter/billing/ai-reservation";
import { serverEnv } from "@quieter/env/server";
import { APICallError } from "ai";
import { z } from "zod";

import {
  getMailAiRequestBudget,
  providerUsageResponseSchema,
  runBilledAiRequest,
} from "./billing";
import type { AiUsageReport } from "./chat-usage";
import type { AutomationMailMessage } from "./classify-gmail-message";
import { AI_PROMPT_SECURITY_POLICY } from "./prompt-security";

export const VERIFICATION_CODE_MODEL = "liquid/d1.2-ultra";

const codeField = z
  .string()
  .refine((value) => /^[\p{L}\p{N}-]{4,12}$/u.test(value));

const verificationCodeSchema = z.object({
  code: codeField.nullable(),
  expiresInSeconds: z.number().int().positive().nullable(),
  service: z.string().max(80).nullable(),
});

export type VerificationCodeCandidate = z.infer<typeof verificationCodeSchema>;

const extractionUsageSchema = z.object({
  id: z.string().optional(),
  usage: z.object({
    cost: z.number().nonnegative(),
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

const extractionAnswersSchema = z.object({
  answers: z.object({
    code: z.object({
      type: z.literal("text"),
      value: z.string().nullable(),
    }),
    expiresInSeconds: z.object({
      type: z.literal("number"),
      value: z.number().nullable(),
    }),
    service: z.object({
      type: z.literal("text"),
      value: z.string().nullable(),
    }),
  }),
});

export class MailVerificationCodeTimeoutError extends Error {
  constructor(cause: unknown) {
    super("Mail verification code extraction timed out.", { cause });
    this.name = "MailVerificationCodeTimeoutError";
  }
}

export const extractMailVerificationCode = async ({
  message,
  billing,
  onUsage,
}: {
  message: AutomationMailMessage;
  billing: AiBillingContext;
  onUsage?: (usage: AiUsageReport) => void;
}): Promise<VerificationCodeCandidate> => {
  const apiKey = serverEnv.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("AI features are temporarily unavailable.");
  }
  const requestBudget = await getMailAiRequestBudget(
    VERIFICATION_CODE_MODEL,
    billing
  );
  const abortSignal = AbortSignal.timeout(10_000);
  try {
    const payload = await runBilledAiRequest({
      billing,
      maximumCostUsd: requestBudget.maximumCostUsd,
      run: async () => {
        const response = await fetch(
          "https://openrouter.ai/api/alpha/extractions",
          {
            body: JSON.stringify({
              fields: {
                code: {
                  instructions: `${AI_PROMPT_SECURITY_POLICY}\n\nRead the temporary verification, login, sign-in, authentication, or account confirmation code from the subject, snippet, or body. Copy the complete code of 4 to 12 letters, digits, or hyphens, removing only spaces between its characters. Never read an order, tracking, invoice, reservation, coupon, recovery, or reference number, a URL, a login-link token, or any fragment of one. Return null when there is no unambiguous temporary access code.`,
                  null_threshold: 0.5,
                  type: "text",
                },
                expiresInSeconds: {
                  instructions: `${AI_PROMPT_SECURITY_POLICY}\n\nThe code's validity duration converted to seconds, as stated by the message. Return null when the message states no duration.`,
                  integer: true,
                  null_threshold: 0.5,
                  type: "number",
                  unit: "seconds",
                },
                service: {
                  instructions: `${AI_PROMPT_SECURITY_POLICY}\n\nA short, human-readable name of the sender or account the code is for. Return null when none is determinable.`,
                  null_threshold: 0.5,
                  type: "text",
                },
              },
              model: VERIFICATION_CODE_MODEL,
              provider: requestBudget.provider,
              state: JSON.stringify({
                body: (message.bodyText ?? message.bodyHtml ?? "").slice(
                  0,
                  12_000
                ),
                from: message.from,
                snippet: message.snippet,
                subject: message.subject,
              }),
            }),
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://quieter.email",
              "X-Title": "quieter",
            },
            method: "POST",
            signal: abortSignal,
          }
        );
        if (!response.ok) {
          throw new APICallError({
            message: `Mail code extraction failed (${response.status}).`,
            requestBodyValues: {},
            responseHeaders: {
              "retry-after": response.headers.get("retry-after") ?? "",
            },
            statusCode: response.status,
            url: "https://openrouter.ai/api/alpha/extractions",
          });
        }
        const responseBody: unknown = await response.json();
        const usage = providerUsageResponseSchema.safeParse(responseBody).data;
        return {
          costUsd: usage?.usage?.cost,
          generationId: usage?.id,
          result: responseBody,
        };
      },
    });
    const { usage } = extractionUsageSchema.parse(payload);
    onUsage?.({
      cacheWriteTokens: 0,
      cachedTokens: 0,
      completionTokens: usage.output_tokens,
      costUsd: usage.cost,
      promptTokens: usage.input_tokens,
    });
    const { answers } = extractionAnswersSchema.parse(payload);
    const expiresInSeconds = answers.expiresInSeconds.value;
    const code = answers.code.value?.replaceAll(/[\s\p{Z}]+/gu, "") ?? null;
    return verificationCodeSchema.parse({
      code: code === null ? null : (codeField.safeParse(code).data ?? null),
      expiresInSeconds:
        expiresInSeconds !== null &&
        Number.isInteger(expiresInSeconds) &&
        expiresInSeconds > 0
          ? expiresInSeconds
          : null,
      service:
        answers.service.value !== null && answers.service.value.length <= 80
          ? answers.service.value
          : null,
    });
  } catch (error) {
    // Workers fetch can recreate the signal's timeout exception.
    if (
      abortSignal.aborted &&
      error instanceof DOMException &&
      error.name === "TimeoutError"
    ) {
      throw new MailVerificationCodeTimeoutError(error);
    }
    throw error;
  }
};
