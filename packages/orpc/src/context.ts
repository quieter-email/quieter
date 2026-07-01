import type {
  RequestHeadersPluginContext,
  ResponseHeadersPluginContext,
} from "@orpc/server/plugins";
import { assertDatabaseConfigured, db } from "@quieter/database/client";

export type OrpcContext = {
  db: typeof db;
  headers: Headers;
  signal?: AbortSignal;
} & RequestHeadersPluginContext &
  ResponseHeadersPluginContext;

export function createOrpcContext(
  options: {
    req?: Request;
    headers?: HeadersInit;
  } = {},
): OrpcContext {
  assertDatabaseConfigured();

  return {
    db,
    headers: new Headers(options.req?.headers ?? options.headers),
    signal: options.req?.signal,
  };
}

export const getRequestHeaders = (context: OrpcContext) => context.reqHeaders ?? context.headers;
