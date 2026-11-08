import { AiCreditAdmissionBusyError } from "@quieter/billing/ai-credit-errors";
import { RetryError } from "ai";
import { describe, expect, it } from "vite-plus/test";

import {
  isAiCreditAdmissionBusy,
  shouldReportAiTaskFailure,
} from "../src/errors";

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
});
