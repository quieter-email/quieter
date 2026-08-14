import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

import { throwEnvironmentValidationError } from "./schema";

const runtimeEnv = typeof process === "undefined" ? {} : process.env;

export const publicEnv = createEnv({
  client: {
    VITE_LOGO_DEV_PUBLISHABLE_KEY: z.string().trim().min(1).optional(),
  },
  clientPrefix: "VITE_",
  emptyStringAsUndefined: true,
  onValidationError: throwEnvironmentValidationError,
  runtimeEnvStrict: {
    VITE_LOGO_DEV_PUBLISHABLE_KEY: runtimeEnv.VITE_LOGO_DEV_PUBLISHABLE_KEY,
  },
});
