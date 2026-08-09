import { timingSafeEqual } from "node:crypto";

export type LambdaFunctionUrlEvent = {
  body?: string | null;
  headers?: Record<string, string | undefined> | null;
  isBase64Encoded?: boolean;
  requestContext?: {
    http?: {
      method?: string;
    };
  };
};

export type LambdaFunctionUrlResponse = {
  body: string;
  headers?: Record<string, string>;
  statusCode: number;
};

export const toJson = (
  body: unknown,
  statusCode = 200
): LambdaFunctionUrlResponse => ({
  body: JSON.stringify(body),
  headers: {
    "cache-control": "no-store",
    "content-type": "application/json",
  },
  statusCode,
});

export const getBearerToken = (
  headers: Record<string, string | undefined> | null | undefined
) => {
  if (headers === null || headers === undefined) {
    return null;
  }

  const authorizationEntry = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === "authorization"
  );
  const authorization = authorizationEntry?.[1]?.trim() ?? null;

  if (
    authorization === null ||
    authorization === undefined ||
    !authorization.startsWith("Bearer ")
  ) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
};

export const bearerTokenMatches = (actual: string | null, expected: string) => {
  if (actual === null || actual === undefined || actual === "") {
    return false;
  }

  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
};

export const parseEventJson = (event: LambdaFunctionUrlEvent): unknown => {
  if (event.body === null || event.body === undefined || event.body === "") {
    return null;
  }

  const text =
    event.isBase64Encoded === true
      ? Buffer.from(event.body, "base64").toString("utf-8")
      : event.body;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};
