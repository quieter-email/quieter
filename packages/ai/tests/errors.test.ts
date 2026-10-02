import { NoOutputGeneratedError } from "ai";
import { describe, expect, it } from "vite-plus/test";

import {
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
