import { AiCreditAdmissionBusyError } from "@quieter/billing/ai-credit-errors";
import { NoOutputGeneratedError, RetryError } from "ai";

export const isAiCreditAdmissionBusy = (error: unknown): boolean => {
  const visited = new Set<unknown>();
  let current = error;
  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);
    if (current instanceof AiCreditAdmissionBusyError) {
      return true;
    }
    current = RetryError.isInstance(current)
      ? current.lastError
      : current.cause;
  }
  return false;
};

/**
 * Provider throttling and transient connectivity failures are handled by the
 * automation retry backoff, so they are not application failures.
 */
export const isTransientAiProviderError = (error: unknown): boolean => {
  const visited = new Set<unknown>();
  let current = error;
  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);
    if (
      current.name === "AI_APICallError" &&
      (("statusCode" in current &&
        (current.statusCode === 429 || current.statusCode === 503)) ||
        ("isRetryable" in current && current.isRetryable === true))
    ) {
      return true;
    }
    current = RetryError.isInstance(current)
      ? current.lastError
      : current.cause;
  }
  return false;
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
  if (isAiCreditAdmissionBusy(error) || isTransientAiProviderError(error)) {
    return false;
  }
  return !(isAiEmptyOutputError(error) && attemptCount > 1);
};
