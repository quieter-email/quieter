import type {
  RequestHeadersPluginContext,
  ResponseHeadersPluginContext,
} from "@orpc/server/plugins";
import { assertDatabaseConfigured, db } from "@quietr/database";

export type OrpcContext = {
  db: typeof db;
  headers: Headers;
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
  };
}

export const getRequestHeaders = (context: OrpcContext) => context.reqHeaders ?? context.headers;
