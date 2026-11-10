import type * as DatabaseClientModule from "@quieter/database/client";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { getAiUsageCostMicroCents } from "../src/ai-pricing.ts";
import { reserveAiCreditUsage } from "../src/ai-reservation.ts";
import type { AiBillingContext } from "../src/ai-reservation.ts";
import type * as CreditsModule from "../src/credits.ts";

const state = vi.hoisted(() => ({
  available: 10_000_000,
  held: 0,
  oldestCreatedAt: null as Date | null,
  query:
    vi.fn<
      (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
  unlimited: false,
}));

vi.mock(import("../src/credits.ts"), async (original) => ({
  ...(await original()),
  lockBillingAccount: async () => {
    await Promise.resolve();
    return { billingOwnerUserId: "synthetic-payer", closingAt: null };
  },
  recordBillingCreditUsage:
    vi.fn<typeof CreditsModule.recordBillingCreditUsage>(),
}));
vi.mock(import("../src/budget.ts"), async (original) => ({
  ...(await original()),
  getBillingBudget: async () => {
    await Promise.resolve();
    return {
      authorizedCostMicroCents: state.unlimited
        ? null
        : Math.max(0, state.available - state.held),
      includedRemainingMicroCents: Math.max(0, state.available - state.held),
      overageRemainingMicroCents: 0,
      pendingAiMicroCents: state.held,
      pendingMicroCents: state.held,
      settledIncludedRemainingMicroCents: state.available,
    };
  },
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("@quieter/database/client", async (original) => {
  const actual = await original<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const database = drizzle(state.query);
  let previous = Promise.resolve();
  return {
    ...actual,
    db: {
      transaction: async <Result>(
        run: (transaction: typeof database) => Promise<Result>
      ) => {
        const acquired = previous;
        const released = Promise.withResolvers<undefined>();
        previous = released.promise;
        await acquired;
        try {
          return await run(database);
        } finally {
          // oxlint-disable-next-line unicorn/no-useless-undefined -- This resolver requires its explicit value.
          released.resolve(undefined);
        }
      },
    },
  };
});

const now = new Date();
const billing: Extract<AiBillingContext, { kind: "team" }> = {
  account: {
    creditAmountCents: 10,
    currentPeriodEnd: new Date(now.getTime() + 3_600_000),
    currentPeriodStart: new Date(now.getTime() - 3_600_000),
    externalCustomerId: "synthetic-account",
    organizationId: "synthetic-team",
    product: "pro",
  },
  admittedAt: now,
  groupId: "synthetic-mail",
  kind: "team",
  organizationId: "synthetic-team",
  usageKind: "verificationCode",
};

describe("AI reservation capacity", () => {
  beforeEach(() => {
    state.available = 10_000_000;
    state.held = 0;
    state.oldestCreatedAt = null;
    state.unlimited = false;
    state.query.mockReset();
    state.query.mockImplementation(async (query, params) => {
      await Promise.resolve();
      if (query.startsWith("insert")) {
        const insertion = /\((?<columns>.*?)\) values \((?<values>.*?)\)/u.exec(
          query
        );
        const columns = insertion?.groups?.columns.split(", ") ?? [];
        const values = insertion?.groups?.values.split(", ") ?? [];
        const index = columns.indexOf('"reservedCostMicroCents"');
        const parameter = /\$(?<index>\d+)/u.exec(values[index] ?? "");
        state.held += Number(params[Number(parameter?.groups?.index) - 1]);
        state.oldestCreatedAt ??= billing.admittedAt;
        return { rows: [] };
      }
      return {
        rows:
          state.oldestCreatedAt === null
            ? []
            : [[state.oldestCreatedAt, "existing"]],
      };
    });
  });

  test("admits independent provider attempts concurrently while preserving each complete hold", async () => {
    const maximumCostUsd = 0.01;
    const results = await Promise.all([
      reserveAiCreditUsage(billing, maximumCostUsd),
      reserveAiCreditUsage(billing, maximumCostUsd),
    ]);
    expect(new Set(results).size).toBe(2);
    expect(state.held).toBe(2 * getAiUsageCostMicroCents(maximumCostUsd));
  });

  test("retains unknown holds and denies another attempt when the remaining capacity is insufficient", async () => {
    state.available = 2_000_000;
    await reserveAiCreditUsage(billing, 0.01);
    const { held } = state;
    await expect(reserveAiCreditUsage(billing, 0.01)).rejects.toThrow(
      /current request/iu
    );
    expect(state.held).toBe(held);
  });

  test("keeps unbounded calls exclusive and preserves their unresolved reservation", async () => {
    await reserveAiCreditUsage(billing);
    await expect(reserveAiCreditUsage(billing, 0.01)).rejects.toThrow(
      /current request/iu
    );
    expect(state.held).toBe(state.available);
  });

  test("allows one existing low-balance request without admitting siblings", async () => {
    state.available = 100;
    await reserveAiCreditUsage(billing, 0.01);
    expect(state.held).toBe(state.available);
    await expect(reserveAiCreditUsage(billing, 0.01)).rejects.toThrow(
      /current request/iu
    );
  });

  test("preserves an unlimited account's unbounded hold without creating zero-authorized siblings", async () => {
    state.unlimited = true;
    await reserveAiCreditUsage(billing);
    const { held } = state;
    await expect(reserveAiCreditUsage(billing, 0.01)).rejects.toThrow(
      /current request/iu
    );
    expect(state.held).toBe(held);
  });

  test("retains unresolved prior-period reservations even when the new period has capacity", async () => {
    state.oldestCreatedAt = new Date(now.getTime() - 7_200_000);
    await expect(reserveAiCreditUsage(billing, 0.01)).rejects.toThrow(
      /current request/iu
    );
    expect(state.held).toBe(0);
  });
});
