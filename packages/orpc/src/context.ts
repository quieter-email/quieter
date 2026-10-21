import type {
  RequestHeadersPluginContext,
  ResponseHeadersPluginContext,
} from "@orpc/server/plugins";
import { assertDatabaseConfigured, db } from "@quieter/database/client";

export type OrpcContext = {
  db: typeof db;
  headers: Headers;
  scheduleBackgroundTask?: (task: Promise<unknown>) => void;
  signal?: AbortSignal;
} & RequestHeadersPluginContext &
  ResponseHeadersPluginContext;

export const createOrpcContext = (
  options: {
    req?: Request;
    headers?: HeadersInit;
    scheduleBackgroundTask?: (task: Promise<unknown>) => void;
  } = {}
): OrpcContext => {
  assertDatabaseConfigured();

  return {
    db,
    headers: new Headers(options.req?.headers ?? options.headers),
    scheduleBackgroundTask: options.scheduleBackgroundTask,
    signal: options.req?.signal,
  };
};

export const getRequestHeaders = (context: OrpcContext): Headers =>
  context.reqHeaders ?? context.headers;
