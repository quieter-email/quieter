import { z } from "zod";

export type RuntimeEnvironment = Record<string, string | undefined>;

export const optionalString = z.string().trim().min(1).optional();
export const optionalUrl = z.string().trim().url().optional();

export const optionalBooleanString = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(["0", "1", "false", "no", "off", "on", "true", "yes"]))
  .transform((value) => ["1", "on", "true", "yes"].includes(value))
  .optional();

export const nodeEnvironment = z.enum(["development", "production", "test"]).default("development");
