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

export const toJson = (body: unknown, statusCode = 200): LambdaFunctionUrlResponse => ({
  body: JSON.stringify(body),
  headers: {
    "cache-control": "no-store",
    "content-type": "application/json",
  },
  statusCode,
});

export const getBearerToken = (headers: Record<string, string | undefined> | null | undefined) => {
  const authorization = headers
    ? Object.entries(headers)
        .find(([name]) => name.toLowerCase() === "authorization")?.[1]
        ?.trim() || null
    : null;

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
};

export const parseEventJson = (event: LambdaFunctionUrlEvent) => {
  if (!event.body) {
    return null;
  }

  const text = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
