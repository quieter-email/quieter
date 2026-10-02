import { ORPCError } from "@orpc/server";
import * as Sentry from "@sentry/cloudflare";
import { isNotFound, isRedirect } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";

export const withServerErrorReporting = async <Result>(
  run: () => Promise<Result>,
  mechanismType: string
): Promise<Result> => {
  try {
    return await run();
  } catch (error) {
    if (
      !isRedirect(error) &&
      !isNotFound(error) &&
      !(error instanceof ORPCError && error.status < 500) &&
      !(error instanceof Response && error.status < 500)
    ) {
      Sentry.captureException(error, {
        mechanism: { handled: false, type: mechanismType },
      });
    }
    throw error;
  }
};

export const sentryRequestErrorMiddleware = createMiddleware().server(
  async ({ next }) =>
    await withServerErrorReporting(
      async () => await next(),
      "auto.middleware.tanstackstart.request"
    )
);

export const sentryFunctionErrorMiddleware = createMiddleware({
  type: "function",
}).server(
  async ({ next }) =>
    await withServerErrorReporting(
      async () => await next(),
      "auto.middleware.tanstackstart.server_function"
    )
);
