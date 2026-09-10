import { NoOutputGeneratedError } from "ai";

/**
 * Provider throttling and transient connectivity failures are handled by the
 * automation retry backoff, so they are not application failures.
 */
export const isTransientAiProviderError = (error: unknown): boolean => {
  if (!(error instanceof Error) || error.name !== "AI_APICallError") {
    return false;
  }
  if (
    "statusCode" in error &&
    (error.statusCode === 429 || error.statusCode === 503)
  ) {
    return true;
  }
  return "isRetryable" in error && error.isRetryable === true;
};

export const isAiEmptyOutputError = (error: unknown): boolean =>
  NoOutputGeneratedError.isInstance(error);

/**
 * Empty model output is reported once so a systematic prompt or model
 * regression stays visible, while its retries and transient provider failures
 * are not. Every other failure keeps normal reporting.
 */
export const shouldReportAiTaskFailure = (
  error: unknown,
  attemptCount: number
): boolean => {
  if (isTransientAiProviderError(error)) {
    return false;
  }
  return !(isAiEmptyOutputError(error) && attemptCount > 1);
};
