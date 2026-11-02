import { createEnv } from "@t3-oss/env-core";

import {
  optionalHttpUrl,
  optionalString,
  throwEnvironmentValidationError,
} from "./schema";
import type { RuntimeEnvironment } from "./schema";

export const createCliEnv = (runtimeEnv: RuntimeEnvironment = process.env) =>
  createEnv({
    emptyStringAsUndefined: true,
    onValidationError: throwEnvironmentValidationError,
    runtimeEnv: {
      QUIETER_MAIL_API_KEY: runtimeEnv.QUIETER_MAIL_API_KEY,
      QUIETER_MAIL_API_URL: runtimeEnv.QUIETER_MAIL_API_URL,
    },
    server: {
      QUIETER_MAIL_API_KEY: optionalString,
      QUIETER_MAIL_API_URL: optionalHttpUrl,
    },
  });
