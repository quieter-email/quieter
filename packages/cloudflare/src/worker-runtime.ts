import {
  configureErrorReporter,
  prepareReportedEvent,
} from "@quieter/observability";
import * as Sentry from "@sentry/cloudflare";
import { z } from "zod";

export { reportError as reportWorkerError } from "@quieter/observability";

const runtimeReportError = globalThis as typeof globalThis & {
  reportError?: (error: unknown) => void;
};

const linkedSecretSchema = z.object({ value: z.string().min(1) });

// oxlint-disable-next-line promise/prefer-await-to-callbacks -- Configures the synchronous reporter hook.
configureErrorReporter((error, context) => {
  runtimeReportError.reportError?.(error);
  if (Sentry.getClient() !== undefined) {
    const tags: Record<string, string> = {};
    for (const [key, value] of Object.entries(context)) {
      if (value !== undefined) {
        tags[key] = String(value);
      }
    }
    Sentry.captureException(error, { tags });
  }
});

export const readLinkedSecret = (value: string) =>
  linkedSecretSchema.parse(JSON.parse(value)).value;

export const readOptionalLinkedSecret = (value: string | undefined) =>
  value === undefined || value === ""
    ? undefined
    : linkedSecretSchema.safeParse(JSON.parse(value)).data?.value;

export const withSentryReporting = <Handler extends ExportedHandler<Env>>(
  handler: Handler
): Handler =>
  Sentry.withSentry<Env, unknown, unknown, Handler>((runtimeEnv: unknown) => {
    const bindings =
      typeof runtimeEnv === "object" && runtimeEnv !== null ? runtimeEnv : {};
    const dsnBinding =
      "SST_RESOURCE_SentryDsn" in bindings &&
      typeof bindings.SST_RESOURCE_SentryDsn === "string"
        ? bindings.SST_RESOURCE_SentryDsn
        : undefined;
    const environment =
      "SENTRY_ENVIRONMENT" in bindings &&
      typeof bindings.SENTRY_ENVIRONMENT === "string"
        ? bindings.SENTRY_ENVIRONMENT
        : undefined;

    return {
      beforeSend: (event, hint) =>
        prepareReportedEvent(event, hint.originalException),
      dsn: readOptionalLinkedSecret(dsnBinding),
      environment,
      tracesSampleRate: 0,
    };
  }, handler);
