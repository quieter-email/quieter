import { ORPCError } from "@orpc/server";
import type { getBillingCreditUsage } from "@quieter/billing/credits";
import type { hasUserBillingFeature } from "@quieter/billing/entitlements";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { getMailAutomationAiBudgetStatus } from "../src/mail-automation/ai-budget";
import { setMailboxAutoLabeling } from "../src/mail-automation/settings";
import type {
  assertAccessibleMailbox,
  getAuthorizedManagedMailbox,
} from "../src/mailbox/service";

const fixtures = vi.hoisted(() => ({
  access: vi.fn<typeof assertAccessibleMailbox>(),
  credits: vi.fn<typeof getBillingCreditUsage>(),
  entitlement: vi.fn<typeof hasUserBillingFeature>(),
  manager: vi.fn<typeof getAuthorizedManagedMailbox>(),
  saved: [] as {
    enabled: boolean | undefined;
    mailboxId: string;
    table: string;
  }[],
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The fake implements only the settings upsert exercised here.
vi.mock("@quieter/database/client", () => ({
  db: {
    insert: (table: Parameters<typeof getTableName>[0]) => ({
      values: (values: {
        autoLabelEnabled?: boolean;
        enabled?: boolean;
        mailboxId: string;
      }) => ({
        onConflictDoUpdate: () => {
          fixtures.saved.push({
            enabled: values.autoLabelEnabled ?? values.enabled,
            mailboxId: values.mailboxId,
            table: getTableName(table),
          });
        },
      }),
    }),
  },
}));
vi.mock(import("@quieter/billing/credits"), () => ({
  getBillingCreditUsage: fixtures.credits,
}));
vi.mock(import("@quieter/billing/entitlements"), () => ({
  hasUserBillingFeature: fixtures.entitlement,
}));
vi.mock(import("../src/mailbox/service"), () => ({
  assertAccessibleMailbox: fixtures.access,
  getAuthorizedManagedMailbox: fixtures.manager,
}));

const input = {
  enabled: true,
  mailboxId: "mailbox-1",
  userId: "user-1",
};

describe("mail automation settings", () => {
  beforeEach(() => {
    fixtures.saved.length = 0;
    fixtures.access.mockReset().mockResolvedValue({
      capabilities: getMailboxCapabilities({ provider: "gmail" }),
      contentRevision: 0,
      id: input.mailboxId,
      organizationId: "organization-1",
      provider: "gmail",
    });
    fixtures.manager.mockReset().mockResolvedValue({
      contentRevision: 0,
      displayName: null,
      emailAddress: "mail@example.com",
      id: input.mailboxId,
      organizationId: "organization-1",
      ownerUserId: null,
      provider: "managed",
      role: "manager",
    });
    fixtures.entitlement.mockReset().mockResolvedValue({
      account: {
        creditAmountCents: 1,
        currentPeriodEnd: new Date("2026-11-01"),
        currentPeriodStart: new Date("2026-10-01"),
        externalCustomerId: "customer-1",
        organizationId: "organization-1",
        product: "pro",
      },
      hasAccess: true,
      hasUnlimitedAccess: false,
      product: "pro",
    });
    fixtures.credits.mockReset().mockResolvedValue({
      billableCostMicroCents: 10,
      breakdown: [],
      costMicroCents: 10,
      creditAmountMicroCents: 10,
    });
  });

  test.each(["gmail", "managed"] as const)(
    "allows enabling %s automation while AI credits are exhausted",
    async (provider) => {
      fixtures.access.mockResolvedValue({
        capabilities: getMailboxCapabilities({ provider, role: "manager" }),
        contentRevision: 0,
        id: input.mailboxId,
        organizationId: "organization-1",
        provider,
      });
      await expect(
        getMailAutomationAiBudgetStatus({
          organizationId: "organization-1",
          userId: input.userId,
        })
      ).resolves.toMatchObject({ allowed: false, reason: "credits_exhausted" });

      await expect(setMailboxAutoLabeling(input)).resolves.toMatchObject({
        enabled: true,
        mailboxId: input.mailboxId,
      });
      expect(fixtures.saved).toContainEqual(
        expect.objectContaining({ enabled: true, mailboxId: input.mailboxId })
      );
      expect(fixtures.access).toHaveBeenCalledWith({
        mailboxId: input.mailboxId,
        userId: input.userId,
      });
    }
  );

  test("does not save settings for an inaccessible mailbox", async () => {
    fixtures.access.mockRejectedValue(new ORPCError("NOT_FOUND"));

    await expect(setMailboxAutoLabeling(input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(fixtures.saved).toHaveLength(0);
  });

  test("requires managed-mailbox manager access before saving", async () => {
    fixtures.access.mockResolvedValue({
      capabilities: getMailboxCapabilities({
        provider: "managed",
        role: "reader",
      }),
      contentRevision: 0,
      id: input.mailboxId,
      organizationId: "organization-1",
      provider: "managed",
    });
    fixtures.manager.mockRejectedValue(new ORPCError("NOT_FOUND"));

    await expect(setMailboxAutoLabeling(input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(fixtures.manager).toHaveBeenCalledWith({
      mailboxId: input.mailboxId,
      requiredRoles: ["manager"],
      userId: input.userId,
    });
    expect(fixtures.saved).toHaveLength(0);
  });
});
