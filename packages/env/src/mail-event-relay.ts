import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

import {
  optionalBooleanString,
  throwEnvironmentValidationError,
} from "./schema";
import type { RuntimeEnvironment } from "./schema";

const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

export const createMailEventRelayEnv = (
  runtimeEnv: RuntimeEnvironment = process.env
) => {
  const env = createEnv({
    onValidationError: throwEnvironmentValidationError,
    runtimeEnvStrict: {
      GMAIL_LIVE_SYNC_TOKEN_SECRET: runtimeEnv.GMAIL_LIVE_SYNC_TOKEN_SECRET,
      MAIL_DISPATCH_URL: runtimeEnv.MAIL_DISPATCH_URL,
      MAIL_EVENT_REPLICATION_SLOT: runtimeEnv.MAIL_EVENT_REPLICATION_SLOT,
      MAIL_EVENT_REPLICATION_URL: runtimeEnv.MAIL_EVENT_REPLICATION_URL,
      QUIETER_MAIL_EVENT_RELAY_SHARDED:
        runtimeEnv.QUIETER_MAIL_EVENT_RELAY_SHARDED,
    },
    server: {
      GMAIL_LIVE_SYNC_TOKEN_SECRET: z.string().min(1),
      MAIL_DISPATCH_URL: z.url().transform((value, ctx) => {
        const url = new URL(value);
        if (
          (url.protocol === "https:" ||
            (url.protocol === "http:" && loopbackHosts.has(url.hostname))) &&
          url.pathname === "/mail/dispatch/event" &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        ) {
          return url;
        }
        ctx.addIssue({
          code: "custom",
          message: "MAIL_DISPATCH_URL must be the full mail dispatch endpoint.",
        });
        return z.NEVER;
      }),
      MAIL_EVENT_REPLICATION_SLOT: z.string().regex(/^[a-z0-9_]{1,61}$/u),
      MAIL_EVENT_REPLICATION_URL: z.url().transform((value, ctx) => {
        const url = new URL(value);
        if (
          ["postgres:", "postgresql:"].includes(url.protocol) &&
          url.hostname &&
          !url.host.includes(",") &&
          !url.hash &&
          url.pathname.length > 1
        ) {
          return url;
        }
        ctx.addIssue({
          code: "custom",
          message:
            "MAIL_EVENT_REPLICATION_URL must target a single direct PostgreSQL endpoint.",
        });
        return z.NEVER;
      }),
      QUIETER_MAIL_EVENT_RELAY_SHARDED: optionalBooleanString,
    },
  });
  return {
    ...env,
    requireFailover: !loopbackHosts.has(
      env.MAIL_EVENT_REPLICATION_URL.hostname
    ),
  };
};
