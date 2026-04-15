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

export const readConfiguredEnv = (...names: string[]) => {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
};

export const toJson = (body: unknown, statusCode = 200): LambdaFunctionUrlResponse => ({
  body: JSON.stringify(body),
  headers: {
    "cache-control": "no-store",
    "content-type": "application/json",
  },
  statusCode,
});

const getHeader = (
  headers: Record<string, string | undefined> | null | undefined,
  name: string,
) => {
  if (!headers) {
    return null;
  }

  const lowerName = name.toLowerCase();
  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (headerName.toLowerCase() === lowerName) {
      return headerValue?.trim() || null;
    }
  }

  return null;
};

export const getBearerToken = (headers: Record<string, string | undefined> | null | undefined) => {
  const authorization = getHeader(headers, "authorization");

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
