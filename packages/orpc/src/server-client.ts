import { createRouterClient } from "@orpc/server";
import type { RouterClient } from "@orpc/server";

import { createOrpcContext } from "./context";
import { appRouter } from "./routers/index";

type HeaderSource = HeadersInit | (() => HeadersInit | Promise<HeadersInit>);

const isResolver = <TValue>(
  value: TValue | (() => TValue | Promise<TValue>)
): value is () => TValue | Promise<TValue> => typeof value === "function";

const resolveValue = async <TValue>(
  value: TValue | (() => TValue | Promise<TValue>)
): Promise<TValue> => {
  if (isResolver(value)) {
    return await value();
  }
  return value;
};

export const createOrpcServerClient = (options?: {
  headers?: HeaderSource;
}): RouterClient<typeof appRouter> =>
  createRouterClient(appRouter, {
    context: async () =>
      createOrpcContext({
        headers:
          options?.headers === undefined
            ? undefined
            : await resolveValue(options.headers),
      }),
  });
