import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

type WebClientRuntimeEnv = Readonly<{
  VITE_LOGO_DEV_PUBLISHABLE_KEY?: string;
  VITE_PUBLIC_C15T_URL?: string;
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
      VITE_LOGO_DEV_PUBLISHABLE_KEY: z.string().trim().min(1).optional(),
      VITE_PUBLIC_C15T_URL: z.string().trim().min(1).default("/api/c15t"),
      VITE_PUBLIC_POSTHOG_HOST: z.string().trim().url().default("https://eu.i.posthog.com"),
      VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: z.string().trim().min(1).optional(),
      VITE_SENTRY_DSN: z.string().trim().url().optional(),
    },
    clientPrefix: "VITE_",
    emptyStringAsUndefined: true,
    runtimeEnvStrict: {
      VITE_LOGO_DEV_PUBLISHABLE_KEY: read("VITE_LOGO_DEV_PUBLISHABLE_KEY"),
      VITE_PUBLIC_C15T_URL: read("VITE_PUBLIC_C15T_URL"),
      VITE_PUBLIC_POSTHOG_HOST: read("VITE_PUBLIC_POSTHOG_HOST"),
      VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: read("VITE_PUBLIC_POSTHOG_PROJECT_TOKEN"),
      VITE_SENTRY_DSN: read("VITE_SENTRY_DSN"),
    },
  });
};
