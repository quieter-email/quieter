import { AiCreditAdmissionBusyError } from "@quieter/billing/ai-credit-errors";
import { NoOutputGeneratedError, RetryError } from "ai";
import { describe, expect, it } from "vite-plus/test";

import {
  isAiCreditAdmissionBusy,
  isAiEmptyOutputError,
  isTransientAiProviderError,
  shouldReportAiTaskFailure,
} from "../src/errors";

const apiCallError = (statusCode: number, isRetryable = false) =>
  Object.assign(new Error("provider call failed"), {
    isRetryable,
    name: "AI_APICallError",
    statusCode,
  });

describe("AI error classification", () => {
  it("distinguishes contention through SDK wrapping without trusting copy", () => {
    const busy = new AiCreditAdmissionBusyError();
    const wrapped = new RetryError({
      errors: [new Error("wrapped", { cause: busy })],
      message: "retry failed",
      reason: "maxRetriesExceeded",
    });
    expect(isAiCreditAdmissionBusy(wrapped)).toBeTruthy();
    expect(shouldReportAiTaskFailure(wrapped, 1)).toBeFalsy();
    expect(
      isAiCreditAdmissionBusy(
        Object.assign(new Error(busy.message), { code: "FORBIDDEN" })
      )
    ).toBeFalsy();
    const cyclic = new Error("cycle");
    cyclic.cause = cyclic;
    expect(isAiCreditAdmissionBusy(cyclic)).toBeFalsy();
  });

  it("treats throttling and retryable provider calls as transient", () => {
    expect(isTransientAiProviderError(apiCallError(429))).toBeTruthy();
    expect(isTransientAiProviderError(apiCallError(503))).toBeTruthy();
    expect(isTransientAiProviderError(apiCallError(500, true))).toBeTruthy();
    expect(isTransientAiProviderError(apiCallError(400))).toBeFalsy();
    expect(isTransientAiProviderError(new Error("boom"))).toBeFalsy();
  });

  it("recognizes empty model output", () => {
    expect(isAiEmptyOutputError(new NoOutputGeneratedError())).toBeTruthy();
    expect(isAiEmptyOutputError(new Error("boom"))).toBeFalsy();
  });

  it("reports transient failures never and empty output once", () => {
    expect(shouldReportAiTaskFailure(apiCallError(429), 1)).toBeFalsy();
    expect(shouldReportAiTaskFailure(apiCallError(429), 5)).toBeFalsy();
    expect(
      shouldReportAiTaskFailure(new NoOutputGeneratedError(), 1)
    ).toBeTruthy();
    expect(
      shouldReportAiTaskFailure(new NoOutputGeneratedError(), 2)
    ).toBeFalsy();
  });

  it("keeps reporting unexpected failures", () => {
    expect(shouldReportAiTaskFailure(new Error("boom"), 1)).toBeTruthy();
    expect(shouldReportAiTaskFailure(new Error("boom"), 3)).toBeTruthy();
  });
});
