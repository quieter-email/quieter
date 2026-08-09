import { z } from "zod";

export type RuntimeEnvironment = Record<string, string | undefined>;

export const throwEnvironmentValidationError = (
  issues: readonly { message: string }[]
): never => {
  const message = issues
    .map(({ message: issueMessage }) => issueMessage)
    .join("; ");
  throw new Error(message || "Invalid environment variables");
};

export const optionalString = z.string().trim().min(1).optional();
export const optionalUrl = z.string().trim().pipe(z.url()).optional();
export const httpUrl = z
  .string()
  .trim()
  .pipe(z.url())
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
    message: "URL must use HTTP or HTTPS.",
  });
export const httpsUrl = httpUrl.refine(
  (value) => new URL(value).protocol === "https:",
  {
    message: "URL must use HTTPS.",
  }
);
export const optionalHttpUrl = httpUrl.optional();
export const webSocketUrl = z
  .string()
  .trim()
  .pipe(z.url())
  .refine((value) => ["ws:", "wss:"].includes(new URL(value).protocol), {
    message: "URL must use WS or WSS.",
  });

export const optionalBooleanString = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(["0", "1", "false", "no", "off", "on", "true", "yes"]))
  .transform((value) => ["1", "on", "true", "yes"].includes(value))
  .optional();

export const nodeEnvironment = z
  .enum(["development", "production", "test"])
  .default("development");
