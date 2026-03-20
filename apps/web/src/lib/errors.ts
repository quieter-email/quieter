const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseJsonMessage = (value: string): unknown => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const extractMessage = (value: unknown, seen = new Set<unknown>()): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = parseJsonMessage(trimmed);
    if (parsed !== value) {
      return extractMessage(parsed, seen) ?? trimmed;
    }

    return trimmed;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value instanceof Error) {
    return extractMessage(value.message, seen) ?? extractMessage(value.cause, seen);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const message = extractMessage(item, seen);
      if (message) {
        return message;
      }
    }

    return null;
  }

  if (!isRecord(value) || seen.has(value)) {
    return null;
  }

  seen.add(value);

  for (const key of ["message", "error_description", "detail", "title", "reason"] as const) {
    if (key in value) {
      const message = extractMessage(value[key], seen);
      if (message) {
        return message;
      }
    }
  }

  if ("errors" in value) {
    const message = extractMessage(value.errors, seen);
    if (message) {
      return message;
    }
  }

  for (const key of ["error", "cause", "data", "shape"] as const) {
    if (key in value) {
      const message = extractMessage(value[key], seen);
      if (message) {
        return message;
      }
    }
  }

  return null;
};

export const getErrorMessage = (error: unknown, fallback: string): string =>
  extractMessage(error) ?? fallback;

export const getFieldErrorMessage = (error: unknown): string | null => extractMessage(error);

export const unwrapResultError = <TResult>(result: TResult, fallback: string): TResult => {
  if (isRecord(result) && "error" in result && result.error) {
    throw new Error(getErrorMessage(result.error, fallback));
  }

  return result;
};
