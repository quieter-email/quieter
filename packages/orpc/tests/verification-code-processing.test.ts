/* oxlint-disable eslint/require-await -- Database and provider doubles resolve without external I/O. */
import type { AiUsageReport } from "@quieter/ai/chat-usage";
import type { detectMailVerificationCode } from "@quieter/ai/classify-gmail-message";
import type { extractMailVerificationCode } from "@quieter/ai/extract-verification-code";
import { AiCreditAdmissionBusyError } from "@quieter/billing/ai-credit-errors";
import { configureErrorReporter } from "@quieter/observability";
import type { ErrorReporter } from "@quieter/observability";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { processMailVerificationCode } from "../src/verification-codes";

type Row = Record<string, unknown>;
const fixtures = vi.hoisted(() => ({
  claimable: true,
  extract: vi.fn<typeof extractMailVerificationCode>(),
  reported: vi.fn<ErrorReporter>(),
  row: null as Row | null,
  screen: vi.fn<typeof detectMailVerificationCode>(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The database double models persistent claims and accumulated usage.
vi.mock("@quieter/database/client", () => ({
  db: {
    insert: () => ({
      values: (values: Row) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (fixtures.row !== null) {
              return [];
            }
            fixtures.row = {
              cacheWriteTokens: null,
              cachedTokens: null,
              completionTokens: null,
              costUsd: null,
              model: null,
              nextAttemptAt: null,
              processedAt: null,
              promptTokens: null,
              usageReportedAt: null,
              ...values,
            };
            return [fixtures.row];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (fixtures.row === null ? [] : [fixtures.row]),
        }),
      }),
    }),
    update: () => ({
      set: (values: Row) => ({
        where: () => {
          if (fixtures.row !== null && fixtures.claimable) {
            Object.assign(fixtures.row, values);
          }
          return {
            returning: async () =>
              fixtures.claimable && fixtures.row !== null ? [fixtures.row] : [],
          };
        },
      }),
    }),
  },
}));
vi.mock(
  import("@quieter/ai/classify-gmail-message"),
  async (importOriginal) => ({
    ...(await importOriginal()),
    detectMailVerificationCode: fixtures.screen,
  })
);
vi.mock(
  import("@quieter/ai/extract-verification-code"),
  async (importOriginal) => ({
    ...(await importOriginal()),
    extractMailVerificationCode: fixtures.extract,
  })
);
vi.mock(import("@quieter/billing/ai-reservation"), () => ({
  createMailboxAiBillingContext: async () => ({
    account: null,
    admittedAt: new Date(),
    groupId: "fixture",
    kind: "team" as const,
    organizationId: "organization-1",
    usageKind: "verificationCode" as const,
  }),
}));
vi.mock(import("../src/mail-automation/ai-budget"), () => ({
  getMailAutomationAiBudgetStatus: async () => ({
    allowed: true as const,
    reason: "allowed" as const,
  }),
}));
vi.mock(import("../src/verification-codes/crypto"), () => ({
  decryptVerificationCode: (code: string) => code,
  encryptVerificationCode: (code: string) => `encrypted-${code}`,
}));
vi.mock(import("../src/mail-updates"), () => ({
  publishMailUpdate: async () => {},
}));

const input = {
  loadMessage: async () => ({
    bodyText: "Your login code is 482193.",
    from: "Login <login@example.test>",
    id: "message-1",
    internalDate: String(Date.now()),
    labelIds: ["INBOX"],
    subject: "Your login code",
    threadId: "thread-1",
  }),
  mailboxId: "mailbox-1",
  messageId: "message-1",
  userId: "user-1",
};
const screenUsage: AiUsageReport = {
  cacheWriteTokens: 0,
  cachedTokens: 0,
  completionTokens: 3,
  costUsd: 0.001,
  promptTokens: 30,
};

describe("verification code processing retries", () => {
  beforeEach(() => {
    fixtures.row = null;
    fixtures.claimable = true;
    fixtures.screen.mockReset().mockResolvedValue(0.9);
    fixtures.extract
      .mockReset()
      .mockResolvedValue({ code: null, expiresInSeconds: null, service: null });
    fixtures.reported.mockReset();
    configureErrorReporter(fixtures.reported);
  });

  test.each(["screen", "extract"] as const)(
    "keeps admission contention in %s separate from provider failures",
    async (stage) => {
      fixtures.screen.mockImplementation(async ({ onUsage }) => {
        onUsage?.(screenUsage);
        return 0.9;
      });
      fixtures[stage].mockRejectedValue(new AiCreditAdmissionBusyError());
      const result = await processMailVerificationCode(input);
      expect(result).toMatchObject({
        reason: "admission_busy",
        status: "retry",
      });
      expect(fixtures.row).toMatchObject({
        attemptCount: 0,
        leaseToken: null,
        leaseUntil: null,
        processedAt: null,
      });
      expect(Number(fixtures.row?.nextAttemptAt)).toBeGreaterThan(Date.now());
      expect(Number(fixtures.row?.nextAttemptAt) - Date.now()).toBeLessThan(
        30_000
      );
      expect(fixtures.reported).not.toHaveBeenCalled();
    }
  );

  test("preserves completed screening usage when extraction must wait for admission", async () => {
    fixtures.screen.mockImplementation(async ({ onUsage }) => {
      onUsage?.(screenUsage);
      return 0.9;
    });
    fixtures.extract.mockRejectedValue(new AiCreditAdmissionBusyError());
    await processMailVerificationCode(input);
    expect(fixtures.row?.costUsd).toBeGreaterThan(0);
    expect(fixtures.row?.promptTokens).toBeGreaterThan(0);
    expect(fixtures.row?.usageReportedAt).toBeNull();
  });

  test("keeps provider failures on their existing backoff", async () => {
    fixtures.extract.mockRejectedValue(
      new Error("Synthetic provider failure.")
    );
    const result = await processMailVerificationCode(input);
    expect(result).toMatchObject({ reason: "failure", status: "retry" });
    expect(fixtures.row?.attemptCount).toBe(1);
    expect(Number(fixtures.row?.nextAttemptAt) - Date.now()).toBeGreaterThan(
      60_000
    );
    expect(fixtures.reported.mock.calls.length).toBeGreaterThan(0);
  });

  test("does not complete work while another claim still owns extraction", async () => {
    fixtures.claimable = false;
    fixtures.row = {
      id: "existing-event",
      leaseUntil: new Date(Date.now() + 60_000),
      processedAt: null,
      usageReportedAt: new Date(),
    };
    await expect(processMailVerificationCode(input)).resolves.toMatchObject({
      reason: "in_progress",
      status: "retry",
    });
    expect(fixtures.screen).not.toHaveBeenCalled();
  });

  test("recognizes an already processed event without rerunning screening", async () => {
    fixtures.claimable = false;
    fixtures.row = {
      id: "existing-event",
      processedAt: new Date(),
      usageReportedAt: new Date(),
    };
    await expect(processMailVerificationCode(input)).resolves.toMatchObject({
      status: "complete",
    });
    expect(fixtures.screen).not.toHaveBeenCalled();
  });
});
