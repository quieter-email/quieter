import { configureErrorReporter } from "@quieter/observability";
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
  Sentry.withSentry(
    (env) => ({
      dsn: readOptionalLinkedSecret(env.SST_RESOURCE_SentryDsn),
      environment: env.SENTRY_ENVIRONMENT,
      tracesSampleRate: 0,
    }),
    handler
  );
