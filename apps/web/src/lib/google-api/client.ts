import type { z } from "zod";
import { getAccessToken } from "~/lib/auth";

type QueryPrimitive = string | number | boolean | null | undefined;

export type GoogleApiQueryParams = Record<string, QueryPrimitive | QueryPrimitive[]>;

type GoogleApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type GoogleApiRequestOptions = {
  accessToken?: string | null;
  signal?: AbortSignal;
};

export type JsonBody = Record<string, unknown>;

const isJsonObject = (x: unknown): x is JsonBody =>
  x !== null && typeof x === "object" && Object.getPrototypeOf(x) === Object.prototype;

export type GoogleApiEndpoint<TParams, TResponseSchema extends z.ZodTypeAny> = {
  path: (params: TParams) => string;
  responseSchema: TResponseSchema;
  method?: GoogleApiMethod;
  query?: (params: TParams) => GoogleApiQueryParams;
  headers?: (params: TParams) => HeadersInit | undefined;
  body?: (params: TParams) => BodyInit | JsonBody | null | undefined;
  cache?: RequestCache;
};

export const defineGoogleApiEndpoint = <TParams, TResponseSchema extends z.ZodTypeAny>(
  endpoint: GoogleApiEndpoint<TParams, TResponseSchema>,
): GoogleApiEndpoint<TParams, TResponseSchema> => endpoint;

const normalizeBaseUrl = (url: string): string => url.replace(/\/+$/, "");

const normalizePath = (path: string): string => (path.startsWith("/") ? path : `/${path}`);

const appendQueryParams = (url: URL, query: GoogleApiQueryParams | undefined) => {
  if (!query) return;

  for (const [key, rawValue] of Object.entries(query)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];

    for (const value of values) {
      if (value == null) continue;
      url.searchParams.append(key, String(value));
    }
  }
};

const createGoogleApiError = (message: string, status: number): Error & { status: number } => {
  const error = new Error(`${message} (${status})`) as Error & { status: number };
  error.status = status;
  return error;
};

export const resolveProviderAccessToken = async (
  providerId: string,
  accessToken?: string | null,
): Promise<string> => {
  if (accessToken) return accessToken;

  const resolvedAccessToken = await getAccessToken(providerId);
  if (!resolvedAccessToken) {
    throw new Error(`Failed to get access token for provider "${providerId}"`);
  }

  return resolvedAccessToken;
};

export const createGoogleApiClient = (options: { baseUrl: string; providerId?: string }) => {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const providerId = options.providerId ?? "google";

  const request = async <TResponseSchema extends z.ZodTypeAny>(args: {
    path: string;
    responseSchema: TResponseSchema;
    method?: GoogleApiMethod;
    query?: GoogleApiQueryParams;
    headers?: HeadersInit;
    body?: BodyInit | JsonBody | null;
    cache?: RequestCache;
    accessToken?: string | null;
    signal?: AbortSignal;
  }): Promise<z.infer<TResponseSchema>> => {
    const accessToken = await resolveProviderAccessToken(providerId, args.accessToken);
    const url = new URL(`${baseUrl}${normalizePath(args.path)}`);
    appendQueryParams(url, args.query);
    const headers = new Headers(args.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);

    let body: BodyInit | null | undefined;
    if (isJsonObject(args.body)) {
      body = JSON.stringify(args.body);
      headers.set("Content-Type", "application/json");
    } else {
      body = args.body;
    }

    const response = await fetch(url.toString(), {
      method: args.method ?? "GET",
      headers,
      body,
      cache: args.cache ?? "no-store",
      signal: args.signal,
    });

    if (!response.ok) {
      throw createGoogleApiError(
        `Failed Google API request: ${args.method ?? "GET"} ${args.path}`,
        response.status,
      );
    }

    return args.responseSchema.parse(await response.json());
  };

  return {
    request,
  };
};
