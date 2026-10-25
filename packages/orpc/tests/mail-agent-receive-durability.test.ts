import type { managedMailMessage } from "@quieter/database/schema";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { captureManagedMessageMemory } from "../src/ai-memory-capture";
import type { enqueueMailAgentMessage } from "../src/mail-agent/inbox";
import type {
  ensureMailImportanceWork,
  processPendingMailImportance,
} from "../src/mail-importance";
import type { publishMailUpdate } from "../src/mail-updates";
import type {
  getManagedAutomationOwner,
  loadManagedAutomationMessage,
  processManagedMailAutomation,
} from "../src/managed-mail/automation";
import type { inheritManagedThreadLabels } from "../src/managed-mail/labels/repository";
import { recordInboundManagedMessage } from "../src/managed-mail/messages/ingestion";
import type { applyManagedRulesToMessage } from "../src/managed-mail/rules/evaluator";
import type {
  processMailVerificationCode,
  reportPendingMailboxVerificationCodeUsage,
} from "../src/verification-codes";

type IncomingRecord = Pick<
  typeof managedMailMessage.$inferSelect,
  "createdAt" | "id" | "mailboxId" | "providerMessageId" | "threadId"
>;

const fixtures = vi.hoisted(() => {
  const messages: IncomingRecord[] = [];
  return { enqueue: vi.fn<typeof enqueueMailAgentMessage>(), messages };
});

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The fake implements the ingestion database methods only.
vi.mock("@quieter/database/client", async () => {
  const { getTableName } = await import("drizzle-orm");
  const database = {
    insert: () => ({
      values: (value: IncomingRecord) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            if (
              fixtures.messages.some(
                (message) =>
                  message.providerMessageId === value.providerMessageId
              )
            ) {
              return [];
            }
            fixtures.messages.push(value);
            return [value];
          },
        }),
      }),
    }),
    select: () => ({
      from: (table: Parameters<typeof getTableName>[0]) => {
        const rows =
          getTableName(table) === "mailbox"
            ? [{ emailAddress: "team@example.test", id: "mailbox" }]
            : fixtures.messages;
        const query = {
          for: () => query,
          innerJoin: () => query,
          limit: () => rows,
          // oxlint-disable-next-line unicorn/no-thenable -- Drizzle queries can be awaited before limit is applied.
          then: async (onFulfilled?: (values: typeof rows) => unknown) =>
            await onFulfilled?.(rows),
          where: () => query,
        };
        return query;
      },
    }),
    update: () => ({ set: () => ({ where: () => {} }) }),
  };
  return {
    db: {
      ...database,
      transaction: async <Result>(
        run: (transaction: typeof database) => Promise<Result>
      ): Promise<Result> => await run(database),
    },
  };
});

vi.mock(import("../src/mail-agent/inbox"), () => ({
  enqueueMailAgentMessage: fixtures.enqueue,
}));
vi.mock(import("../src/ai-memory-capture"), () => ({
  captureManagedMessageMemory: vi.fn<typeof captureManagedMessageMemory>(),
}));
vi.mock(import("../src/mail-importance"), () => ({
  ensureMailImportanceWork: vi.fn<typeof ensureMailImportanceWork>(),
  processPendingMailImportance: vi.fn<typeof processPendingMailImportance>(),
}));
vi.mock(import("../src/mail-updates"), () => ({
  publishMailUpdate: vi.fn<typeof publishMailUpdate>(),
}));
vi.mock(import("../src/verification-codes"), () => ({
  processMailVerificationCode: vi.fn<typeof processMailVerificationCode>(),
  reportPendingMailboxVerificationCodeUsage:
    vi.fn<typeof reportPendingMailboxVerificationCodeUsage>(),
}));
vi.mock(import("../src/managed-mail/automation"), () => ({
  getManagedAutomationOwner: vi.fn<typeof getManagedAutomationOwner>(),
  loadManagedAutomationMessage: vi.fn<typeof loadManagedAutomationMessage>(),
  processManagedMailAutomation: vi.fn<typeof processManagedMailAutomation>(),
}));
vi.mock(import("../src/managed-mail/labels/repository"), () => ({
  inheritManagedThreadLabels: vi.fn<typeof inheritManagedThreadLabels>(),
}));
vi.mock(import("../src/managed-mail/rules/evaluator"), () => ({
  applyManagedRulesToMessage: vi
    .fn<typeof applyManagedRulesToMessage>()
    .mockResolvedValue({ error: null, matched: false }),
}));

const arrival = new Date("2026-10-22T12:00:00Z");
const input = {
  providerMessageId: "delivery",
  rawMessage: Buffer.from(
    "From: sender@example.test\r\nTo: team@example.test\r\nSubject: New mail\r\n\r\nHello"
  ),
  rawObjectBucket: "local-mail",
  rawObjectKey: "delivery.eml",
  rawObjectProvider: "s3" as const,
  rawSizeBytes: 100,
  receivedAt: arrival,
  recipients: ["team@example.test"],
};

describe("durable managed mail action receive", () => {
  beforeEach(() => {
    fixtures.messages.length = 0;
    fixtures.enqueue.mockReset().mockResolvedValue();
  });

  test("withholds receive acknowledgement until the durable inbox write completes", async () => {
    const started = Promise.withResolvers<boolean>();
    const durable = Promise.withResolvers<boolean>();
    fixtures.enqueue.mockImplementation(async () => {
      started.resolve(true);
      await durable.promise;
    });
    let acknowledged = false;
    const receipt = recordInboundManagedMessage(input).then((result) => {
      acknowledged = true;
      return result;
    });
    await Promise.race([started.promise, receipt]);
    expect(acknowledged).toBeFalsy();
    durable.resolve(true);
    await expect(receipt).resolves.toContain("mailbox");
    expect(fixtures.messages[0]?.createdAt).toStrictEqual(arrival);
  });

  test("retries enqueue after a persisted-message failure without changing original arrival time", async () => {
    fixtures.enqueue.mockRejectedValueOnce(new Error("Inbox unavailable"));
    await expect(recordInboundManagedMessage(input)).rejects.toThrow(
      "Inbox unavailable"
    );
    expect(fixtures.messages).toHaveLength(1);

    await expect(
      recordInboundManagedMessage({
        ...input,
        receivedAt: new Date("2026-10-23T12:00:00Z"),
      })
    ).resolves.toContain("mailbox");
    expect(fixtures.messages).toHaveLength(1);
    expect(fixtures.enqueue).toHaveBeenLastCalledWith(
      expect.objectContaining({ receivedAt: arrival })
    );
  });
});
