import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

import { httpUrl, throwEnvironmentValidationError } from "./schema";

type WebClientRuntimeEnv = Readonly<{
  VITE_QUIETER_LOCAL_TELEMETRY?: string;
  VITE_QUIETER_PREVIEW_PERSONAS_ENABLED?: string;
  VITE_LOGO_DEV_PUBLISHABLE_KEY?: string;
  VITE_PUBLIC_POSTHOG_HOST?: string;
  VITE_PUBLIC_POSTHOG_PROJECT_TOKEN?: string;
  VITE_SENTRY_DSN?: string;
}>;

export const createWebClientEnv = (runtimeEnv: object) => {
  const read = (name: keyof WebClientRuntimeEnv) => {
    const value: unknown = Reflect.get(runtimeEnv, name);
    return typeof value === "string" ? value : undefined;
  };

  return createEnv({
    client: {
      VITE_LOGO_DEV_PUBLISHABLE_KEY: z.string().trim().min(1).optional(),
      VITE_PUBLIC_POSTHOG_HOST: httpUrl.default("https://eu.i.posthog.com"),
      VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: z.string().trim().min(1).optional(),
      VITE_QUIETER_LOCAL_TELEMETRY: z.enum(["true", "false"]).default("false"),
      VITE_QUIETER_PREVIEW_PERSONAS_ENABLED: z
        .enum(["true", "false"])
        .default("false"),
      VITE_SENTRY_DSN: httpUrl.optional(),
    },
    clientPrefix: "VITE_",
    emptyStringAsUndefined: true,
    onValidationError: throwEnvironmentValidationError,
    runtimeEnvStrict: {
      VITE_LOGO_DEV_PUBLISHABLE_KEY: read("VITE_LOGO_DEV_PUBLISHABLE_KEY"),
      VITE_PUBLIC_POSTHOG_HOST: read("VITE_PUBLIC_POSTHOG_HOST"),
      VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: read(
        "VITE_PUBLIC_POSTHOG_PROJECT_TOKEN"
      ),
      VITE_QUIETER_LOCAL_TELEMETRY: read("VITE_QUIETER_LOCAL_TELEMETRY"),
      VITE_QUIETER_PREVIEW_PERSONAS_ENABLED: read(
        "VITE_QUIETER_PREVIEW_PERSONAS_ENABLED"
      ),
      VITE_SENTRY_DSN: read("VITE_SENTRY_DSN"),
    },
  });
};
