import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { httpUrl } from "./schema";

type WebClientRuntimeEnv = Readonly<{
  VITE_QUIETER_DEPLOYMENT_ENV?: string;
  VITE_QUIETER_PREVIEW_PERSONAS_ENABLED?: string;
  VITE_LOGO_DEV_PUBLISHABLE_KEY?: string;
  VITE_PUBLIC_POSTHOG_HOST?: string;
  VITE_PUBLIC_POSTHOG_PROJECT_TOKEN?: string;
  VITE_SENTRY_DSN?: string;
}>;

export const createWebClientEnv = (runtimeEnv: object) => {
  const read = (name: keyof WebClientRuntimeEnv) => {
    const value = Reflect.get(runtimeEnv, name);
    return typeof value === "string" ? value : undefined;
  };

  return createEnv({
    client: {
      VITE_QUIETER_DEPLOYMENT_ENV: z.enum(["preview", "production"]).default("production"),
      VITE_QUIETER_PREVIEW_PERSONAS_ENABLED: z.enum(["true", "false"]).default("false"),
      VITE_LOGO_DEV_PUBLISHABLE_KEY: z.string().trim().min(1).optional(),
      VITE_PUBLIC_POSTHOG_HOST: httpUrl.default("https://eu.i.posthog.com"),
      VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: z.string().trim().min(1).optional(),
      VITE_SENTRY_DSN: httpUrl.optional(),
    },
    clientPrefix: "VITE_",
    emptyStringAsUndefined: true,
    runtimeEnvStrict: {
      VITE_QUIETER_DEPLOYMENT_ENV: read("VITE_QUIETER_DEPLOYMENT_ENV"),
      VITE_QUIETER_PREVIEW_PERSONAS_ENABLED: read("VITE_QUIETER_PREVIEW_PERSONAS_ENABLED"),
      VITE_LOGO_DEV_PUBLISHABLE_KEY: read("VITE_LOGO_DEV_PUBLISHABLE_KEY"),
      VITE_PUBLIC_POSTHOG_HOST: read("VITE_PUBLIC_POSTHOG_HOST"),
      VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: read("VITE_PUBLIC_POSTHOG_PROJECT_TOKEN"),
      VITE_SENTRY_DSN: read("VITE_SENTRY_DSN"),
    },
  });
};
