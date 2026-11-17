import { ORPCError } from "@orpc/server";
import type { reportError } from "@quieter/observability";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { Mock } from "vite-plus/test";

import type { AiOrigin } from "../src/ai-authority";
import type { publishMailUpdate } from "../src/mail-updates";
import { materializeSentReminder } from "../src/reminders/sent";
import type { requestReminderWake } from "../src/reminders/wake";

type SentIntentFixtures = {
  access: Mock<() => Promise<void>>;
  insertFailure: Error | undefined;
  ownerUserId: string;
  policy: { automationPaused: boolean; readOnly: boolean; version: number };
  publish: Mock<typeof publishMailUpdate>;
  records: Record<string, unknown>[];
  reportError: Mock<typeof reportError>;
  wake: Mock<typeof requestReminderWake>;
};

const fixtures = vi.hoisted<SentIntentFixtures>(() => ({
  access: vi.fn<() => Promise<void>>(),
  insertFailure: undefined,
  ownerUserId: "owner",
  policy: { automationPaused: false, readOnly: false, version: 1 },
  publish: vi.fn<typeof publishMailUpdate>(),
  records: [],
  reportError: vi.fn<typeof reportError>(),
  wake: vi.fn<typeof requestReminderWake>(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- This fake supplies SQL I/O while retaining the actual authority and reminder persistence services.
vi.mock("@quieter/database/client", async () => {
  const { getTableName } = await import("drizzle-orm");
  const database = {
    insert: (table: Parameters<typeof getTableName>[0]) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: () => {
          let inserted: Record<string, unknown>[] = [];
          if (getTableName(table) === "mailReminder") {
            if (fixtures.insertFailure !== undefined) {
              throw fixtures.insertFailure;
            }
            const duplicate = fixtures.records.some(
              (record) =>
                record.mailboxId === values.mailboxId &&
                record.userId === values.userId &&
                record.requestId === values.requestId
            );
            if (!duplicate) {
              fixtures.records.push(values);
              inserted = [values];
            }
          }
          return { returning: async () => await Promise.resolve(inserted) };
        },
      }),
    }),
    select: () => ({
      from: (table: Parameters<typeof getTableName>[0]) => {
        const name = getTableName(table);
        let rows: unknown[] = [];
        if (name === "mailbox") {
          rows = [
            {
              accessMode: "private",
              id: "private-inbox",
              managedOwnerUserId: null,
              organizationId: "organization",
              ownerUserId: fixtures.ownerUserId,
              provider: "gmail",
            },
          ];
        } else if (name === "mailboxAiAuthority") {
          rows = [fixtures.policy];
        } else if (name === "mailReminder") {
          rows = fixtures.records;
        }
        const query = {
          for: async () => await Promise.resolve(rows),
          limit: async () => await Promise.resolve(rows),
          where: () => query,
        };
        return query;
      },
    }),
  };
  return {
    db: {
      ...database,
      transaction: async <Result>(
        run: (transaction: typeof database) => Promise<Result>
      ) => await run(database),
    },
  };
});

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Mailbox preparation is held independently of the actual final access and policy checks.
vi.mock("../src/mailbox/service", () => ({
  assertAccessibleMailbox: fixtures.access,
}));
vi.mock(import("../src/mail-updates"), () => ({
  publishMailUpdate: fixtures.publish,
}));
vi.mock(import("../src/reminders/wake"), () => ({
  requestReminderWake: fixtures.wake,
}));
vi.mock(import("@quieter/observability"), () => ({
  reportError: fixtures.reportError,
}));

const origin: AiOrigin = {
  kind: "ai",
  mailboxId: "private-inbox",
  mode: "interactive",
  policyVersion: 1,
  userId: "owner",
};
const sentIntent = {
  intent: {
    condition: "A reply arrives",
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    requestId: "00000000-0000-4000-8000-000000000001",
    timeZone: "UTC",
    title: "Follow up",
  },
  mailboxId: origin.mailboxId,
  messageId: "accepted-message",
  origin,
  threadId: "private-thread",
  userId: origin.userId,
};

describe("accepted-send follow-up authority", () => {
  beforeEach(() => {
    fixtures.access.mockReset().mockResolvedValue();
    fixtures.insertFailure = undefined;
    fixtures.ownerUserId = origin.userId;
    fixtures.policy = {
      automationPaused: false,
      readOnly: false,
      version: origin.policyVersion,
    };
    fixtures.publish.mockClear();
    fixtures.records.length = 0;
    fixtures.reportError.mockClear();
    fixtures.wake.mockReset().mockResolvedValue(false);
  });

  test("does not create an AI reminder after policy changes during preparation", async () => {
    fixtures.access.mockImplementation(async () => {
      await Promise.resolve();
      fixtures.policy.version += 2;
    });
    const result = await materializeSentReminder(sentIntent);
    expect(result).toBeNull();
    expect(fixtures.records).toHaveLength(0);
    expect(fixtures.publish).not.toHaveBeenCalled();
    expect(fixtures.wake).not.toHaveBeenCalled();
    expect(fixtures.reportError).not.toHaveBeenCalled();
  });

  test.each(["automationPaused", "readOnly"] as const)(
    "%s fences a separate automatic follow-up",
    async (flag) => {
      fixtures.policy[flag] = true;
      await expect(
        materializeSentReminder({
          ...sentIntent,
          origin: { ...origin, mode: "automation" },
        })
      ).resolves.toBeNull();
      expect(fixtures.records).toHaveLength(0);
      expect(fixtures.publish).not.toHaveBeenCalled();
      expect(fixtures.reportError).not.toHaveBeenCalled();
    }
  );

  test("rechecks ownership after asynchronous mailbox preparation", async () => {
    fixtures.access.mockImplementation(async () => {
      await Promise.resolve();
      fixtures.ownerUserId = "another-owner";
    });
    await expect(materializeSentReminder(sentIntent)).resolves.toBeNull();
    expect(fixtures.records).toHaveLength(0);
    expect(fixtures.publish).not.toHaveBeenCalled();
    expect(fixtures.reportError).not.toHaveBeenCalled();
  });

  test("AI intent does not turn denied inbox access into a suspended write", async () => {
    fixtures.access.mockRejectedValue(new ORPCError("FORBIDDEN"));
    await expect(materializeSentReminder(sentIntent)).resolves.toBeNull();
    expect(fixtures.records).toHaveLength(0);
    expect(fixtures.publish).not.toHaveBeenCalled();
    expect(fixtures.reportError).not.toHaveBeenCalled();
  });

  test("an unproven legacy intent cannot be relabeled as human", async () => {
    await expect(
      materializeSentReminder({ ...sentIntent, origin: undefined })
    ).resolves.toBeNull();
    expect(fixtures.records).toHaveLength(0);
    expect(fixtures.access).not.toHaveBeenCalled();
    expect(fixtures.reportError).not.toHaveBeenCalled();
  });

  test.each([
    { ...origin, policyVersion: "1" },
    { kind: "human", policyVersion: 1 },
    {
      kind: "ai",
      mailboxId: origin.mailboxId,
      mode: "automation",
      policyVersion: 1,
      scope: "mailbox-automation",
    },
  ])(
    "unknown authority cannot create a private reminder",
    async (authority) => {
      await expect(
        materializeSentReminder({ ...sentIntent, origin: authority })
      ).resolves.toBeNull();
      expect(fixtures.records).toHaveLength(0);
      expect(fixtures.publish).not.toHaveBeenCalled();
    }
  );

  test("a foreign actor stamp cannot authorize the saved intent", async () => {
    await expect(
      materializeSentReminder({
        ...sentIntent,
        origin: { ...origin, userId: "another-user" },
      })
    ).resolves.toBeNull();
    expect(fixtures.records).toHaveLength(0);
    expect(fixtures.publish).not.toHaveBeenCalled();
  });

  test("current AI intent recovery retains its permanent reminder identity", async () => {
    const first = await materializeSentReminder(sentIntent);
    const repeated = await materializeSentReminder(sentIntent);
    expect(fixtures.records).toHaveLength(1);
    expect(first?.id).toBe(repeated?.id);
    expect(fixtures.records).toMatchObject([
      { mailboxId: origin.mailboxId, status: "active", userId: origin.userId },
    ]);
  });

  test("explicit human intent remains available under both AI policies", async () => {
    fixtures.policy.automationPaused = true;
    fixtures.policy.readOnly = true;
    const reminder = await materializeSentReminder({
      ...sentIntent,
      origin: { kind: "human" },
    });
    expect(reminder?.status).toBe("active");
    expect(fixtures.records).toHaveLength(1);
    expect(fixtures.publish).toHaveBeenCalledOnce();
  });

  test("human intent recovery preserves suspension after access loss", async () => {
    fixtures.access.mockRejectedValue(new ORPCError("NOT_FOUND"));
    const reminder = await materializeSentReminder({
      ...sentIntent,
      origin: { kind: "human" },
    });
    expect(reminder?.status).toBe("suspended");
    expect(fixtures.records).toHaveLength(1);
    expect(fixtures.publish).not.toHaveBeenCalled();
    expect(fixtures.wake).not.toHaveBeenCalled();
  });

  test("unexpected persistence failure remains visible to the receipt owner", async () => {
    const failure = new Error("Reminder storage unavailable.");
    fixtures.insertFailure = failure;
    await expect(materializeSentReminder(sentIntent)).rejects.toBe(failure);
    expect(fixtures.records).toHaveLength(0);
    expect(fixtures.publish).not.toHaveBeenCalled();
  });
});
