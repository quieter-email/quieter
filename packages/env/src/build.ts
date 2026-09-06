import { z } from "zod";

import { createWebClientEnv } from "./client";
import type { RuntimeEnvironment } from "./schema";

export const createWebBuildEnv = (
  runtime: RuntimeEnvironment = process.env
) => {
  const result = z
    .object({
      GITHUB_SHA: z.string().optional(),
      QUIETER_BUILD_ID: z
        .string()
        .regex(/^[\w-]{1,128}$/u)
        .optional(),
      QUIETER_RELEASE_BUILD: z.enum(["true", "false"]).default("false"),
      QUIETER_RELEASE_STAGE: z
        .string()
        .regex(/^[\w-]{1,128}$/u)
        .optional(),
      SENTRY_AUTH_TOKEN: z.string().optional(),
      SENTRY_ORG: z.string().optional(),
      SENTRY_PROJECT: z.string().optional(),
      SST_WRANGLER_PATH: z.string().min(1).optional(),
    })
    .safeParse(runtime);
  if (
    !result.success ||
    (result.data.QUIETER_RELEASE_BUILD === "true" &&
      (result.data.QUIETER_BUILD_ID === undefined ||
        result.data.QUIETER_RELEASE_STAGE === undefined ||
        result.data.SST_WRANGLER_PATH === undefined))
  ) {
    throw new Error("Invalid web build configuration.");
  }
  return result.data;
};

export const createWebReleaseEnvironment = (
  publicConfiguration: unknown,
  runtime: RuntimeEnvironment = process.env
) => {
  const configuration = z
    .strictObject({
      VITE_LOGO_DEV_PUBLISHABLE_KEY: z.string().optional(),
      VITE_PUBLIC_POSTHOG_HOST: z.string().optional(),
      VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: z.string().optional(),
      VITE_QUIETER_LOCAL_TELEMETRY: z.string().optional(),
      VITE_QUIETER_PREVIEW_PERSONAS_ENABLED: z.string().optional(),
      VITE_SENTRY_DSN: z.string().optional(),
    })
    .safeParse(publicConfiguration);
  if (!configuration.success) {
    throw new Error(
      "Release configuration must contain only supported public build settings."
    );
  }
  const publicEnv = createWebClientEnv(configuration.data);
  const environment: Record<string, string> = {};
  const systemKeys = new Set([
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
  ]);
  for (const [key, value] of Object.entries(runtime)) {
    if (value !== undefined && systemKeys.has(key.toUpperCase())) {
      environment[key] = value;
    }
  }
  return { environment, publicConfiguration: { ...publicEnv } };
};
