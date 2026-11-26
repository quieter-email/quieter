import type {
  RequestHeadersPluginContext,
  ResponseHeadersPluginContext,
} from "@orpc/server/plugins";
import { assertDatabaseConfigured, db } from "@quieter/database/client";

export type OrpcContext = {
  db: typeof db;
  headers: Headers;
  mcpUser?: { email: string; id: string; name: string };
  scheduleBackgroundTask?: (task: Promise<unknown>) => void;
  signal?: AbortSignal;
} & RequestHeadersPluginContext &
  ResponseHeadersPluginContext;

export const createOrpcContext = (
  options: {
    req?: Request;
    headers?: HeadersInit;
    mcpUser?: OrpcContext["mcpUser"];
    scheduleBackgroundTask?: (task: Promise<unknown>) => void;
  } = {}
): OrpcContext => {
  assertDatabaseConfigured();

  return {
    db,
    headers: new Headers(options.req?.headers ?? options.headers),
    mcpUser: options.mcpUser,
    scheduleBackgroundTask: options.scheduleBackgroundTask,
    signal: options.req?.signal,
  };
};

export const getRequestHeaders = (context: OrpcContext): Headers =>
  context.reqHeaders ?? context.headers;
