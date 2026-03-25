import { createRouterClient } from "@orpc/server";
import { createOrpcContext } from "./context";
import { appRouter } from "./router";

type HeaderSource = HeadersInit | (() => HeadersInit | Promise<HeadersInit>);

const resolveValue = async <TValue>(value: TValue | (() => TValue | Promise<TValue>)) =>
  typeof value === "function" ? await (value as () => TValue | Promise<TValue>)() : value;

export const createOrpcServerClient = (options?: { headers?: HeaderSource }) =>
  createRouterClient(appRouter, {
    context: async () =>
      createOrpcContext({
        headers: options?.headers ? await resolveValue(options.headers) : undefined,
      }),
  });
