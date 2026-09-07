import { ORPCError } from "@orpc/server";
import type { planAiMemoryUpdate } from "@quieter/ai/ai-memory";
import type { getBillingCreditUsage } from "@quieter/billing/credits";
import type { hasUserBillingFeature } from "@quieter/billing/entitlements";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { requestAiMemoryUpdate } from "../src/ai-memory";
import type { assertAccessibleMailbox } from "../src/mailbox/service";

const mocks = vi.hoisted(() => ({
  access: vi.fn<typeof assertAccessibleMailbox>(),
  entitlement: vi.fn<typeof hasUserBillingFeature>(),
  plan: vi.fn<typeof planAiMemoryUpdate>(),
  usage: vi.fn<typeof getBillingCreditUsage>(),
}));

vi.mock(import("../src/mailbox/service"), async (original) => ({
  ...(await original()),
  assertAccessibleMailbox: mocks.access,
}));
vi.mock(import("@quieter/billing/entitlements"), async (original) => ({
  ...(await original()),
  hasUserBillingFeature: mocks.entitlement,
}));
vi.mock(import("@quieter/billing/credits"), async (original) => ({
  ...(await original()),
  getBillingCreditUsage: mocks.usage,
}));
vi.mock(import("@quieter/ai/ai-memory"), async (original) => ({
  ...(await original()),
  planAiMemoryUpdate: mocks.plan,
}));

const request = {
  mailboxId: "billing-mailbox",
  request: "Remember that I prefer short replies.",
  scope: "user" as const,
  userId: "user",
};

describe("interactive memory billing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.access.mockResolvedValue({
      capabilities: getMailboxCapabilities({ provider: "gmail" }),
      contentRevision: 0,
      id: "billing-mailbox",
      organizationId: "team",
      provider: "gmail",
    });
  });

  test("rejects a fabricated billing mailbox even for personal memory", async () => {
    mocks.access.mockRejectedValue(new ORPCError("NOT_FOUND"));
    await expect(requestAiMemoryUpdate(request)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mocks.plan).not.toHaveBeenCalled();
  });

  test("does not call the model without an AI entitlement", async () => {
    mocks.entitlement.mockResolvedValue({
      account: null,
      hasAccess: false,
      hasUnlimitedAccess: false,
      product: null,
    });
    await expect(requestAiMemoryUpdate(request)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.plan).not.toHaveBeenCalled();
  });

  test("does not call the model when the team balance is exhausted", async () => {
    mocks.entitlement.mockResolvedValue({
      account: {
        creditAmountCents: 1,
        currentPeriodEnd: new Date("2026-10-01"),
        currentPeriodStart: new Date("2026-09-01"),
        externalCustomerId: "customer",
        organizationId: "team",
        product: "pro",
      },
      hasAccess: true,
      hasUnlimitedAccess: false,
      product: "pro",
    });
    mocks.usage.mockResolvedValue({
      billableCostMicroCents: 0,
      breakdown: [],
      costMicroCents: 100,
      creditAmountMicroCents: 100,
    });
    await expect(requestAiMemoryUpdate(request)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.plan).not.toHaveBeenCalled();
  });
});
