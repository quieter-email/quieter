import type * as databaseClient from "@quieter/database/client";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { processMailVerificationCode } from "../src/verification-codes";

const fixtures = vi.hoisted(() => ({
  budget: vi.fn<() => Promise<{ allowed: boolean }>>(),
  extracted:
    vi.fn<
      () => Promise<{ code: string; expiresInSeconds: null; service: null }>
    >(),
  published: vi.fn<() => Promise<void>>(),
  rows: new Map<string, { id: string; processed: boolean }>(),
}));

vi.mock(
  import("@quieter/database/client"),
  () =>
    // The fake implements only the claim and completion operations exercised here.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    ({
      db: {
        insert: () => ({
          values: (value: { id: string; messageId: string }) => ({
            onConflictDoNothing: () => ({
              returning: async () => {
                await Promise.resolve();
                if (fixtures.rows.has(value.messageId)) {
                  return [];
                }
                fixtures.rows.set(value.messageId, {
                  id: value.id,
                  processed: false,
                });
                return [{ id: value.id }];
              },
            }),
          }),
        }),
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => {
                await Promise.resolve();
                return [];
              },
            }),
          }),
        }),
        update: () => ({
          set: (value: { processedAt?: Date }) => ({
            where: () => ({
              returning: async () => {
                await Promise.resolve();
                if (value.processedAt === undefined) {
                  return [];
                }
                const row = fixtures.rows.get("message-1");
                if (row === undefined) {
                  return [];
                }
                row.processed = true;
                return [{ id: row.id }];
              },
            }),
          }),
        }),
      },
    }) as unknown as typeof databaseClient
);
vi.mock(import("@quieter/ai/extract-verification-code"), () => ({
  extractMailVerificationCode: fixtures.extracted,
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
  reportError: vi.fn<() => void>(),
}));

describe("verification code processing", () => {
  beforeEach(() => {
    fixtures.rows.clear();
    fixtures.extracted.mockReset();
    fixtures.published.mockReset();
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
    expect(fixtures.published).not.toHaveBeenCalled();
    expect(fixtures.rows.get("message-1")?.processed).toBeFalsy();
  });
});
