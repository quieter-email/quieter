const getMessage = (error: unknown): string | null => {
  if (typeof error === "string") {
    return error.trim() || null;
  }

  if (error instanceof Error) {
    return error.message.trim() || null;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message.trim() || null;
  }

  return null;
};

export const getErrorMessage = (error: unknown, fallback: string): string =>
  getMessage(error) ?? fallback;

export const unwrapResultError = <TResult>(result: TResult, fallback: string): TResult => {
  if (typeof result === "object" && result !== null && "error" in result && result.error) {
    throw new Error(getErrorMessage(result.error, fallback));
  }

  return result;
};
