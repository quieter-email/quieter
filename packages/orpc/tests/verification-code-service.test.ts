import type { AiUsageReport } from "@quieter/ai/chat-usage";
import type * as databaseClient from "@quieter/database/client";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { processMailVerificationCode } from "../src/verification-codes";

type TestRow = {
  cacheWriteTokens: number | null;
  cachedTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  id: string;
  leaseToken: string | null;
  mailboxId: string;
  model: string | null;
  processed: boolean;
  processedAt: Date | null;
  promptTokens: number | null;
  usageReportedAt: Date | null;
};

const fixtures = vi.hoisted(() => ({
  billed: vi.fn<(input: { costUsd: number }) => Promise<void>>(),
  budget: vi.fn<() => Promise<{ allowed: boolean }>>(),
  extracted:
    vi.fn<
      (input: {
        onUsage?: (usage: AiUsageReport) => void;
      }) => Promise<{ code: string; expiresInSeconds: null; service: null }>
    >(),
  published: vi.fn<() => Promise<void>>(),
  reported: vi.fn<() => void>(),
  rows: new Map<string, TestRow>(),
  screened:
    vi.fn<
      (input: { onUsage?: (usage: AiUsageReport) => void }) => Promise<number>
    >(),
}));

vi.mock(
  import("@quieter/database/client"),
  () =>
    // The fake implements only the claim and completion operations exercised here.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    ({
      db: {
        insert: () => ({
          values: (value: {
            id: string;
            leaseToken: string;
            mailboxId: string;
            messageId: string;
          }) => ({
            onConflictDoNothing: () => ({
              returning: async () => {
                await Promise.resolve();
                if (fixtures.rows.has(value.messageId)) {
                  return [];
                }
                fixtures.rows.set(value.messageId, {
                  cacheWriteTokens: null,
                  cachedTokens: null,
                  completionTokens: null,
                  costUsd: null,
                  id: value.id,
                  leaseToken: value.leaseToken,
                  mailboxId: value.mailboxId,
                  model: null,
                  processed: false,
                  processedAt: null,
                  promptTokens: null,
                  usageReportedAt: null,
                });
                return [fixtures.rows.get(value.messageId)];
              },
            }),
          }),
        }),
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => {
                await Promise.resolve();
                const row = fixtures.rows.get("message-1");
                return row === undefined ? [] : [row];
              },
            }),
          }),
        }),
        update: () => ({
          set: (value: {
            cacheWriteTokens?: number;
            cachedTokens?: number;
            completionTokens?: number;
            costUsd?: number | null;
            leaseToken?: string | null;
            model?: string;
            processedAt?: Date;
            promptTokens?: number;
            usageReportedAt?: Date | null;
          }) => ({
            where: () => {
              const execute = async () => {
                await Promise.resolve();
                const row = fixtures.rows.get("message-1");
                if (row === undefined) {
                  return [];
                }
                if (typeof value.leaseToken === "string") {
                  if (row.processed || row.leaseToken !== null) {
                    return [];
                  }
                  row.leaseToken = value.leaseToken;
                  return [row];
                }
                if (
                  value.usageReportedAt !== undefined &&
                  value.processedAt === undefined
                ) {
                  row.usageReportedAt = value.usageReportedAt;
                  return [row];
                }
                if (row.leaseToken === null) {
                  return [];
                }
                row.leaseToken = null;
                row.cacheWriteTokens =
                  value.cacheWriteTokens ?? row.cacheWriteTokens;
                row.cachedTokens = value.cachedTokens ?? row.cachedTokens;
                row.completionTokens =
                  value.completionTokens ?? row.completionTokens;
                row.costUsd = value.costUsd ?? row.costUsd;
                row.model = value.model ?? row.model;
                row.promptTokens = value.promptTokens ?? row.promptTokens;
                if (value.processedAt !== undefined) {
                  row.processed = true;
                  row.processedAt = value.processedAt;
                  row.usageReportedAt = value.usageReportedAt ?? null;
                }
                return [row];
              };
              return {
                returning: execute,
                // Drizzle queries execute when awaited, even without returning rows.
                // oxlint-disable-next-line unicorn/no-thenable
                then: (
                  onFulfilled: (rows: TestRow[]) => void,
                  onRejected?: (reason: unknown) => void
                ) => {
                  void execute().then(onFulfilled, onRejected);
                },
              };
            },
          }),
        }),
      },
    }) as unknown as typeof databaseClient
);
vi.mock(import("@quieter/ai/extract-verification-code"), () => ({
  extractMailVerificationCode: fixtures.extracted,
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("@quieter/billing", () => ({ reportAiUsage: fixtures.billed }));
// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("@quieter/ai/classify-gmail-message", () => ({
  AUTO_LABEL_MODEL: "typesafe/jev-1.13",
  detectMailVerificationCode: fixtures.screened,
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("../src/mail-automation/ai-budget", () => ({
  getMailAutomationAiBudgetStatus: fixtures.budget,
}));
vi.mock(import("../src/mail-updates"), () => ({
  publishMailUpdate: fixtures.published,
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("../src/mailbox/service", () => ({
  assertAccessibleMailbox: vi.fn<() => Promise<void>>(),
}));
vi.mock(import("../src/verification-codes/crypto"), () => ({
  decryptVerificationCode: (value: string) => value,
  encryptVerificationCode: (value: string) => value,
}));
vi.mock(import("@quieter/observability"), () => ({
  reportError: fixtures.reported,
}));

describe("verification code processing", () => {
  beforeEach(() => {
    fixtures.rows.clear();
    fixtures.billed.mockReset().mockResolvedValue();
    fixtures.extracted.mockReset();
    fixtures.published.mockReset();
    fixtures.reported.mockReset();
    fixtures.screened.mockReset().mockResolvedValue(0.8);
    fixtures.budget.mockReset().mockResolvedValue({ allowed: true });
  });

  test("concurrent delivery invokes extraction once and publishes one result", async () => {
    const extraction = Promise.withResolvers<{
      code: string;
      expiresInSeconds: null;
      service: null;
    }>();
    fixtures.extracted.mockReturnValue(extraction.promise);
    const input = {
      loadMessage: async () => {
        await Promise.resolve();
        return {
          bodyText: "Your sign-in code is 482193",
          id: "message-1",
          internalDate: String(Date.now()),
          threadId: "thread-1",
        };
      },
      mailboxId: "mailbox-1",
      messageId: "message-1",
      organizationId: "org-1",
      userId: "user-1",
    };

    const first = processMailVerificationCode(input);
    await vi.waitFor(() => {
      expect(fixtures.extracted).toHaveBeenCalledOnce();
    });
    await processMailVerificationCode(input);
    extraction.resolve({
      code: "482193",
      expiresInSeconds: null,
      service: null,
    });
    await first;

    expect(fixtures.extracted).toHaveBeenCalledOnce();
    expect(fixtures.screened).toHaveBeenCalledOnce();
    expect(fixtures.published).toHaveBeenCalledOnce();
    expect(fixtures.rows.get("message-1")?.processed).toBeTruthy();
  });

  test("does not invoke the model when the mailbox has no AI budget", async () => {
    fixtures.budget.mockResolvedValue({ allowed: false });
    await processMailVerificationCode({
      loadMessage: async () => {
        await Promise.resolve();
        return {
          bodyText: "Your sign-in code is 482193",
          id: "message-1",
          internalDate: String(Date.now()),
          threadId: "thread-1",
        };
      },
      mailboxId: "mailbox-1",
      messageId: "message-1",
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(fixtures.extracted).not.toHaveBeenCalled();
    expect(fixtures.screened).not.toHaveBeenCalled();
    expect(fixtures.published).not.toHaveBeenCalled();
    expect(fixtures.rows.get("message-1")?.processed).toBeFalsy();
  });

  test("a confident negative screen skips extraction", async () => {
    fixtures.screened.mockResolvedValue(0.05);
    await processMailVerificationCode({
      loadMessage: async () => {
        await Promise.resolve();
        return {
          bodyText: "Your sign-in code is 482193",
          id: "message-1",
          internalDate: String(Date.now()),
          threadId: "thread-1",
        };
      },
      mailboxId: "mailbox-1",
      messageId: "message-1",
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(fixtures.screened).toHaveBeenCalledOnce();
    expect(fixtures.extracted).not.toHaveBeenCalled();
    expect(fixtures.published).not.toHaveBeenCalled();
    expect(fixtures.rows.get("message-1")?.processed).toBeTruthy();
  });

  test("a failed screen falls through to extraction", async () => {
    fixtures.screened.mockRejectedValue(new Error("provider failure"));
    fixtures.extracted.mockResolvedValue({
      code: "482193",
      expiresInSeconds: null,
      service: null,
    });
    await processMailVerificationCode({
      loadMessage: async () => {
        await Promise.resolve();
        return {
          bodyText: "Your sign-in code is 482193",
          id: "message-1",
          internalDate: String(Date.now()),
          threadId: "thread-1",
        };
      },
      mailboxId: "mailbox-1",
      messageId: "message-1",
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(fixtures.extracted).toHaveBeenCalledOnce();
    expect(fixtures.published).toHaveBeenCalledOnce();
    expect(fixtures.reported).toHaveBeenCalledOnce();
  });

  test("positive screening and extraction usage are both retained", async () => {
    fixtures.screened.mockImplementation(async (input) => {
      await Promise.resolve();
      input.onUsage?.({
        cacheWriteTokens: 0,
        cachedTokens: 0,
        completionTokens: 1,
        costUsd: 0.001,
        promptTokens: 10,
      });
      return 0.9;
    });
    fixtures.extracted.mockImplementation(async (input) => {
      await Promise.resolve();
      input.onUsage?.({
        cacheWriteTokens: 0,
        cachedTokens: 0,
        completionTokens: 2,
        costUsd: 0.002,
        promptTokens: 20,
      });
      return { code: "482193", expiresInSeconds: null, service: null };
    });
    await processMailVerificationCode({
      loadMessage: async () => {
        await Promise.resolve();
        return {
          bodyText: "Your sign-in code is 482193",
          id: "message-1",
          internalDate: String(Date.now()),
          threadId: "thread-1",
        };
      },
      mailboxId: "mailbox-1",
      messageId: "message-1",
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(fixtures.rows.get("message-1")?.costUsd).toBeCloseTo(0.003);
    expect(fixtures.rows.get("message-1")?.model).toContain("typesafe/jev");
    expect(fixtures.published).toHaveBeenCalledOnce();
  });

  test("failed extraction usage is billed with successful retry only once", async () => {
    fixtures.screened.mockImplementation(async (input) => {
      await Promise.resolve();
      input.onUsage?.({
        cacheWriteTokens: 0,
        cachedTokens: 0,
        completionTokens: 1,
        costUsd: 0.001,
        promptTokens: 10,
      });
      return 0.9;
    });
    fixtures.extracted
      .mockRejectedValueOnce(new Error("provider failure"))
      .mockImplementationOnce(async (input) => {
        await Promise.resolve();
        input.onUsage?.({
          cacheWriteTokens: 0,
          cachedTokens: 0,
          completionTokens: 2,
          costUsd: 0.002,
          promptTokens: 20,
        });
        return { code: "482193", expiresInSeconds: null, service: null };
      });
    const input = {
      loadMessage: async () => {
        await Promise.resolve();
        return {
          bodyText: "Your sign-in code is 482193",
          id: "message-1",
          internalDate: String(Date.now()),
          threadId: "thread-1",
        };
      },
      mailboxId: "mailbox-1",
      messageId: "message-1",
      organizationId: "org-1",
      userId: "user-1",
    };

    await processMailVerificationCode(input);
    expect(fixtures.rows.get("message-1")?.processed).toBeFalsy();
    expect(fixtures.rows.get("message-1")?.costUsd).toBeCloseTo(0.001);

    await processMailVerificationCode(input);
    await processMailVerificationCode(input);

    expect(fixtures.rows.get("message-1")?.costUsd).toBeCloseTo(0.004);
    expect(fixtures.billed).toHaveBeenCalledOnce();
    expect(fixtures.billed.mock.calls[0]?.[0].costUsd).toBeCloseTo(0.004);
    expect(fixtures.published).toHaveBeenCalledOnce();
  });
});
