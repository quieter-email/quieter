/* oxlint-disable eslint/require-await -- Async mock contracts resolve without network or database I/O. */
import type * as drizzleOrm from "drizzle-orm";
import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import {
  listGmailPubSubMaintenanceJobs,
  retryPendingAutomationMessages,
} from "../src/gmail-sync/service";
import type { getMailAutomationAiBudgetStatus } from "../src/mail-automation/ai-budget";
import { MAIL_AUTOMATION_AI_PAUSED_MESSAGE } from "../src/mail-automation/ai-budget";

type Row = Record<string, unknown>;
type Predicate = (row: Row, outerRow?: Row) => boolean;
type BudgetStatus = Awaited<ReturnType<typeof getMailAutomationAiBudgetStatus>>;

const fixtures = vi.hoisted(() => ({
  budget: vi.fn<() => Promise<BudgetStatus>>(),
  mailboxes: [] as Row[],
  rows: [] as Row[],
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The fake executes predicates against in-memory rows rather than producing SQL.
vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof drizzleOrm>();
  return {
    ...original,
    and:
      (...predicates: Predicate[]) =>
      (row: Row, outerRow?: Row) =>
        predicates.every((predicate) => predicate(row, outerRow)),
    eq:
      (column: { name: string }, value: unknown) =>
      (row: Row, outerRow?: Row) => {
        if (
          value instanceof original.Column &&
          "table" in value &&
          value.table instanceof original.Table
        ) {
          const expected =
            original.getTableName(value.table) === "mailbox"
              ? outerRow?.[value.name]
              : row[value.name];
          return row[column.name] === expected;
        }
        return row[column.name] === value;
      },
    exists: (query: { matches: (outerRow: Row) => boolean }) => (row: Row) =>
      query.matches(row),
    isNotNull: (column: { name: string }) => (row: Row) =>
      row[column.name] !== null,
    isNull: (column: { name: string }) => (row: Row) =>
      row[column.name] === null,
    lte: (column: { name: string }, value: Date) => (row: Row) => {
      const current = row[column.name];
      return current instanceof Date && current <= value;
    },
    or:
      (...predicates: Predicate[]) =>
      (row: Row, outerRow?: Row) =>
        predicates.some((predicate) => predicate(row, outerRow)),
  };
});

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The fake implements only the query methods exercised here.
vi.mock("@quieter/database/client", () => {
  const client = {
    db: {
      insert: () => ({
        values: () => ({ onConflictDoNothing: async () => {} }),
      }),
      select: (fields?: Record<string, { name: string }>) => {
        let rows: Row[] = [];
        const predicates: Predicate[] = [];
        const query = {
          from: (table: Parameters<typeof getTableName>[0]) => {
            if (getTableName(table) === "gmailAutoLabelEvent") {
              ({ rows } = fixtures);
            } else if (getTableName(table) === "mailbox") {
              rows = fixtures.mailboxes;
            } else {
              rows = [];
            }
            return query;
          },
          innerJoin: (_table: unknown, predicate: Predicate) => {
            predicates.push(predicate);
            return query;
          },
          leftJoin: () => query,
          limit: async (limit: number) =>
            rows
              .filter((row) => predicates.every((predicate) => predicate(row)))
              .slice(0, limit)
              .map((row) =>
                fields
                  ? Object.fromEntries(
                      Object.entries(fields).map(([key, column]) => [
                        key,
                        row[column.name],
                      ])
                    )
                  : row
              ),
          matches: (outerRow: Row) =>
            rows.some((row) =>
              predicates.every((predicate) => predicate(row, outerRow))
            ),
          orderBy: () => {
            rows.sort(
              (left, right) =>
                Number(left.nextAttemptAt ?? -Infinity) -
                Number(right.nextAttemptAt ?? -Infinity)
            );
            return query;
          },
          where: (predicate: Predicate) => {
            predicates.push(predicate);
            return query;
          },
        };
        return query;
      },
      update: () => ({
        set: (values: Row) => ({
          where: async (predicate: Predicate) => {
            for (const row of fixtures.rows.filter((candidate) =>
              predicate(candidate)
            )) {
              Object.assign(row, values);
            }
          },
        }),
      }),
    },
  };
  return client;
});

vi.mock(import("../src/verification-codes"), () => ({
  listPendingMailboxVerificationCodeMessageIds: async () => [],
  processMailVerificationCode: vi.fn<() => Promise<void>>(),
  reportPendingMailboxVerificationCodeUsage: vi.fn<() => Promise<void>>(),
}));

const input = {
  accessToken: "fixture-token",
  autoLabelEnabled: true,
  automationRuntime: {
    getAutoLabelContext: async () => ({
      availableLabelIds: new Set<string>(),
      labels: [],
      memoryCandidates: [],
      model: "fixture-model",
    }),
    getBudgetStatus: fixtures.budget,
  },
  mailboxId: "mailbox-1",
  organizationId: "organization-1",
  userId: "user-1",
};

describe("Gmail automation retry recovery", () => {
  beforeEach(() => {
    fixtures.rows.length = 0;
    fixtures.mailboxes.length = 0;
    fixtures.budget.mockReset().mockResolvedValue({
      allowed: true,
      reason: "allowed",
    });
    fixtures.rows.push({
      appliedAt: null,
      attemptCount: 0,
      autoLabelEnabled: true,
      gmailMessageId: "deferred-message",
      id: "deferred-event",
      labelIds: null,
      lastError: "Budget unavailable",
      mailboxId: input.mailboxId,
      nextAttemptAt: new Date(Date.now() + 60_000),
    });
    fixtures.mailboxes.push({
      emailAddress: "mailbox@example.test",
      historyPageToken: null,
      id: input.mailboxId,
      lastErrorAt: null,
      lastReconciledAt: new Date(),
      mailboxId: input.mailboxId,
      provider: "gmail",
      recoveryAfter: null,
      recoveryPageToken: null,
      status: "connected",
      watchExpirationAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
      watchRenewedAt: new Date(),
    });
  });

  test("resumes budget deferrals while preserving real failure backoff and mailbox isolation", async () => {
    const [deferred] = fixtures.rows;
    const failed: Row = {
      ...deferred,
      attemptCount: 1,
      gmailMessageId: "failed-message",
      id: "failed-event",
    };
    const classified: Row = {
      ...deferred,
      gmailMessageId: "classified-message",
      id: "classified-event",
      labelIds: ["label-1"],
    };
    const otherMailbox: Row = {
      ...deferred,
      gmailMessageId: "other-message",
      id: "other-event",
      mailboxId: "mailbox-2",
    };
    fixtures.rows.push(failed, classified, otherMailbox);

    await retryPendingAutomationMessages(input);

    expect(deferred?.appliedAt).toBeInstanceOf(Date);
    expect(failed.appliedAt).toBeNull();
    expect(classified.appliedAt).toBeNull();
    expect(otherMailbox.appliedAt).toBeNull();
  });

  test("keeps future deferrals pending while budget remains denied", async () => {
    fixtures.budget.mockResolvedValue({
      allowed: false,
      message: MAIL_AUTOMATION_AI_PAUSED_MESSAGE,
      reason: "credits_exhausted",
    });

    await retryPendingAutomationMessages(input);

    expect(fixtures.rows[0]?.appliedAt).toBeNull();
    fixtures.budget.mockResolvedValue({ allowed: true, reason: "allowed" });
    await retryPendingAutomationMessages(input);
    expect(fixtures.rows[0]?.appliedAt).toBeInstanceOf(Date);
  });

  test("processes due retries without checking budget solely for future failures", async () => {
    const [due] = fixtures.rows;
    if (due === undefined) {
      throw new Error("Missing retry fixture.");
    }
    due.attemptCount = 1;
    due.nextAttemptAt = new Date(Date.now() - 60_000);
    fixtures.rows.push({
      ...due,
      gmailMessageId: "future-failure-message",
      id: "future-failure",
      nextAttemptAt: new Date(Date.now() + 60_000),
    });

    await retryPendingAutomationMessages(input);

    expect(due.appliedAt).toBeInstanceOf(Date);
    expect(fixtures.rows[1]?.appliedAt).toBeNull();
    expect(fixtures.budget).not.toHaveBeenCalled();
  });

  test("schedules an enabled mailbox's budget backlog even after a recent reconciliation", async () => {
    const jobs = await listGmailPubSubMaintenanceJobs();

    expect(jobs.some((job) => job.mailboxId === input.mailboxId)).toBeTruthy();
  });

  test.each([
    { autoLabelEnabled: false },
    { attemptCount: 1 },
    { labelIds: ["label-1"] },
  ])(
    "does not force maintenance for disabled automation or genuine retry backoff: %j",
    async (state) => {
      Object.assign(fixtures.rows[0] ?? {}, state);

      const jobs = await listGmailPubSubMaintenanceJobs();

      expect(jobs).toHaveLength(0);
    }
  );
});
