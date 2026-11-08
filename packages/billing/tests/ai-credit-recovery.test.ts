import { describe, expect, test } from "vite-plus/test";

import { runAiCreditRecovery } from "../src/ai-credit-recovery.ts";
import { createPolarCreditUsageEvent } from "../src/credits.ts";

const request = {
  confirmation: "incorrect",
  evidence: "incident:provider-export",
  expectedSnapshot: "a".repeat(64),
  mode: "resolve",
  operator: "github-run:123:operator",
  organizationId: "synthetic-team",
  reason: "confirmed-provider-charge",
  reservationId: "11111111-1111-4111-8111-111111111111",
  resolution: { costUsd: 0.01, kind: "actual-cost" },
};

describe("AI credit recovery command boundary", () => {
  test("rejects missing exact confirmation before database access", async () => {
    await expect(runAiCreditRecovery(request)).rejects.toThrow(/confirmation/u);
  });

  test("retains recovery evidence locally when preparing external billing reports", () => {
    const event = createPolarCreditUsageEvent({
      account: { externalCustomerId: "synthetic-team" },
      billableCostMicroCents: 0,
      category: "ai",
      costMicroCents: 1,
      createdAt: new Date(),
      eventId: "synthetic-event",
      metadata: {
        recoveryEvidence: "private-incident:123",
        recoveryOperator: "github-run:123:operator",
        usageKind: "aiChat",
      },
    });
    expect(event.metadata).toMatchObject({ usageKind: "aiChat" });
    expect(JSON.stringify(event)).not.toContain("private-incident");
    expect(JSON.stringify(event)).not.toContain("github-run");
  });
});
