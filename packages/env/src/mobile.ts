import { createEnv } from "@t3-oss/env-core";

import { httpUrl, throwEnvironmentValidationError } from "./schema";

type MobileRuntimeEnv = Readonly<{
  EXPO_PUBLIC_QUIETER_API_URL?: string;
  EXPO_PUBLIC_QUIETER_WEB_URL?: string;
}>;

export const createMobileEnv = (runtimeEnv: object) => {
  const read = (name: keyof MobileRuntimeEnv) => {
    const value: unknown = Reflect.get(runtimeEnv, name);
    return typeof value === "string" ? value : undefined;
  };

  return createEnv({
    client: {
      EXPO_PUBLIC_QUIETER_API_URL: httpUrl.default("http://localhost:3000"),
      EXPO_PUBLIC_QUIETER_WEB_URL: httpUrl.default("http://localhost:3000"),
    },
    clientPrefix: "EXPO_PUBLIC_",
    emptyStringAsUndefined: true,
    onValidationError: throwEnvironmentValidationError,
    runtimeEnvStrict: {
      EXPO_PUBLIC_QUIETER_API_URL: read("EXPO_PUBLIC_QUIETER_API_URL"),
      EXPO_PUBLIC_QUIETER_WEB_URL: read("EXPO_PUBLIC_QUIETER_WEB_URL"),
    },
  });
};

export type MobileEnv = ReturnType<typeof createMobileEnv>;

const mobileRuntimeEnv: MobileRuntimeEnv = {
  EXPO_PUBLIC_QUIETER_API_URL: process.env.EXPO_PUBLIC_QUIETER_API_URL,
  EXPO_PUBLIC_QUIETER_WEB_URL: process.env.EXPO_PUBLIC_QUIETER_WEB_URL,
};

export const mobileEnv = createMobileEnv(mobileRuntimeEnv);
