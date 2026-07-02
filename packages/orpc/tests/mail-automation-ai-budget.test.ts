import { describe, expect, test } from "bun:test";
import {
  MAIL_AUTOMATION_AI_PAUSED_MESSAGE,
  resolveMailAutomationAiBudgetStatus,
} from "../src/mail-automation/ai-budget";

describe("mail automation AI budget", () => {
  test("keeps automation disabled when the runtime switch is off", () => {
    const status = resolveMailAutomationAiBudgetStatus({
      hasAccess: true,
      hasAccount: true,
      hasUnlimitedAccess: false,
      runtimeEnabled: false,
      usage: { costMicroCents: 0, creditAmountMicroCents: 1 },
    });

    expect(status).toMatchObject({
      allowed: false,
      reason: "environment_disabled",
    });
  });

  test("requires remaining team credits before model-backed automation", () => {
    const status = resolveMailAutomationAiBudgetStatus({
      hasAccess: true,
      hasAccount: true,
      hasUnlimitedAccess: false,
      runtimeEnabled: true,
      usage: { costMicroCents: 20_000_000, creditAmountMicroCents: 20_000_000 },
    });

    expect(status).toMatchObject({
      allowed: false,
      message: MAIL_AUTOMATION_AI_PAUSED_MESSAGE,
      reason: "credits_exhausted",
    });
  });

  test("allows automation while credits remain or access is unlimited", () => {
    expect(
      resolveMailAutomationAiBudgetStatus({
        hasAccess: true,
        hasAccount: true,
        hasUnlimitedAccess: false,
        runtimeEnabled: true,
        usage: { costMicroCents: 1, creditAmountMicroCents: 2 },
      }),
    ).toMatchObject({ allowed: true });

    expect(
      resolveMailAutomationAiBudgetStatus({
        hasAccess: true,
        hasAccount: false,
        hasUnlimitedAccess: true,
        runtimeEnabled: true,
      }),
    ).toMatchObject({ allowed: true });
  });
});
