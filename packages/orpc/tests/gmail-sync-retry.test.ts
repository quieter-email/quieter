import type { classifyMailMessage } from "@quieter/ai/classify-gmail-message";
import type { getMessageWithDetails, mutateGmailMessage } from "@quieter/gmail";
import type { AutoLabelSettings } from "@quieter/mail/auto-label";
/* oxlint-disable eslint/require-await -- Async mock contracts resolve without network or database I/O. */
import type * as drizzleOrm from "drizzle-orm";
import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import * as aiMemory from "../src/ai-memory";
import {
  listGmailPubSubMaintenanceJobs,
  retryPendingAutomationMessages,
} from "../src/gmail-sync/service";
import type { getMailAutomationAiBudgetStatus } from "../src/mail-automation/ai-budget";
import { MAIL_AUTOMATION_AI_PAUSED_MESSAGE } from "../src/mail-automation/ai-budget";
import type { loadMailAutoLabelHistory } from "../src/mail-automation/history";
import type { processMailVerificationCode } from "../src/verification-codes";

type Row = Record<string, unknown>;
type Predicate = (row: Row, outerRow?: Row) => boolean;
type BudgetStatus = Awaited<ReturnType<typeof getMailAutomationAiBudgetStatus>>;

const fixtures = vi.hoisted(() => ({
  budget: vi.fn<() => Promise<BudgetStatus>>(),
  classify: vi.fn<typeof classifyMailMessage>(),
  getMessage: vi.fn<typeof getMessageWithDetails>(),
  history: vi.fn<typeof loadMailAutoLabelHistory>(),
  mailboxes: [] as Row[],
  mutate: vi.fn<typeof mutateGmailMessage>(),
  pendingCodeMessageIds: [] as string[],
  processCode: vi.fn<typeof processMailVerificationCode>(),
  rows: [] as Row[],
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The fake executes predicates against in-memory rows rather than producing SQL.
vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof drizzleOrm>();
  const sql = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const [column] = values;
      const inequality = /^\s*<>\s*'(?<expected>[^']+)'/u.exec(
        strings[1] ?? ""
      );
      if (
        column instanceof original.Column &&
        inequality?.groups?.expected !== undefined
      ) {
        return (row: Row) => row[column.name] !== inequality.groups?.expected;
      }
      return original.sql(strings, ...values);
    },
    original.sql
  );
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
      row[column.name] !== null && row[column.name] !== undefined,
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
    sql,
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
          where: (predicate: Predicate) => {
            const updated = fixtures.rows.filter((candidate) =>
              predicate(candidate)
            );
            for (const row of updated) {
              Object.assign(row, values);
            }
            return { returning: async () => updated };
          },
        }),
      }),
    },
  };
  return client;
});

vi.mock(import("@quieter/gmail"), async (importOriginal) => ({
  ...(await importOriginal()),
  getMessageWithDetails: fixtures.getMessage,
  mutateGmailMessage: fixtures.mutate,
}));
vi.mock(
  import("@quieter/ai/classify-gmail-message"),
  async (importOriginal) => ({
    ...(await importOriginal()),
    classifyMailMessage: fixtures.classify,
  })
);
vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    serverEnv: {
      ...original.serverEnv,
      QUIETER_LOCAL_PROVIDER_MODE: "write" as const,
    },
  };
});
vi.mock(import("../src/mail-automation/history"), () => ({
  loadMailAutoLabelHistory: fixtures.history,
}));

vi.mock(import("../src/verification-codes"), () => ({
  listPendingMailboxVerificationCodeMessageIds: async () =>
    fixtures.pendingCodeMessageIds,
  processMailVerificationCode: fixtures.processCode,
  reportPendingMailboxVerificationCodeUsage: vi.fn<() => Promise<void>>(),
}));

const input = {
  accessToken: "fixture-token",
  autoLabelEnabled: true,
  automationRuntime: {
    getAutoLabelContext: async () => ({
      availableLabelIds: new Set<string>(),
      historyLabels: [],
      labels: [],
      memoryCandidates: {
        mailboxId: "mailbox-1",
        userId: "user-1",
      },
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
    fixtures.classify.mockReset();
    fixtures.history.mockReset().mockResolvedValue(null);
    vi.spyOn(aiMemory, "loadAiAgentContext")
      .mockReset()
      .mockResolvedValue({ instructions: null, memory: null });
    fixtures.mutate.mockReset().mockResolvedValue({
      id: "deferred-message",
      isUnread: false,
      labelIds: ["INBOX", "deterministic"],
    });
    fixtures.getMessage.mockReset().mockResolvedValue({
      from: "Sender <mail@example.com>",
      id: "deferred-message",
      labelIds: ["INBOX"],
      threadId: "thread-1",
    });
    fixtures.rows.length = 0;
    fixtures.mailboxes.length = 0;
    fixtures.pendingCodeMessageIds.length = 0;
    fixtures.processCode.mockReset().mockResolvedValue();
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
      lastCapturedAt: new Date(),
      lastErrorAt: null,
      lastReconciledAt: new Date(),
      mailboxId: input.mailboxId,
      pendingHistoryPage: null,
      phase: "history",
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

  test("retries code extraction without scheduling another urgent mail evaluation", async () => {
    fixtures.pendingCodeMessageIds.push("previously-received-message");
    await retryPendingAutomationMessages({ ...input, autoLabelEnabled: false });
    expect(fixtures.processCode).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "previously-received-message" })
    );
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

  test("classifies with current sender history and the user's preferences", async () => {
    fixtures.classify.mockResolvedValue(["work"]);
    vi.mocked(aiMemory.loadAiAgentContext).mockResolvedValue({
      instructions: null,
      memory: "Keep launch announcements under Work.",
    });
    fixtures.history.mockResolvedValue({
      sameDomain: [],
      sameSender: [
        {
          currentLabels: [{ id: "work", name: "Work" }],
          manualCorrections: [
            {
              labelId: "work",
              labelName: "Work",
              recordedAt: new Date().toISOString(),
              signal: "added",
            },
          ],
          messageId: "earlier-message",
          priorAutomaticApplication: null,
          sender: "mail@example.com",
        },
      ],
    });
    await retryPendingAutomationMessages({
      ...input,
      automationRuntime: {
        ...input.automationRuntime,
        getAutoLabelContext: async () => ({
          ...(await input.automationRuntime.getAutoLabelContext()),
          availableLabelIds: new Set(["work"]),
          historyLabels: [
            { id: "work", name: "Work" },
            { id: "manual-only", name: "Manual only" },
          ],
          labels: [
            {
              description: null,
              id: "work",
              inclusionCriteria: null,
              name: "Work",
            },
          ],
        }),
      },
    });

    const [classification] = fixtures.classify.mock.calls[0] ?? [];
    expect(classification?.memoryContext).toContain("launch announcements");
    expect(
      classification?.labelHistory?.sameSender.map((entry) => entry.messageId)
    ).toContain("earlier-message");
    expect(
      classification?.labelHistory?.sameSender.flatMap((entry) =>
        entry.currentLabels.map((label) => label.id)
      )
    ).toContain("work");
    const [historyRequest] = fixtures.history.mock.calls[0] ?? [];
    expect(historyRequest?.mailboxId).toBe(input.mailboxId);
    expect(historyRequest?.message.id).toBe("deferred-message");
    expect(historyRequest?.userId).toBe(input.userId);
    expect(historyRequest?.labels.map((label) => label.id)).toContain(
      "manual-only"
    );
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

  test.each([false, true])(
    "applies deterministic matches while AI budget is exhausted, with mixed AI labels: %s",
    async (mixed) => {
      const [event] = fixtures.rows;
      if (event === undefined) {
        throw new Error("Missing retry fixture.");
      }
      event.nextAttemptAt = new Date(Date.now() - 60_000);
      fixtures.budget.mockResolvedValue({
        allowed: false,
        message: MAIL_AUTOMATION_AI_PAUSED_MESSAGE,
        reason: "credits_exhausted",
      });
      const autoLabel: AutoLabelSettings = {
        domains: [],
        enabled: true,
        keywordScope: "anywhere",
        keywords: [],
        matchMode: "all",
        prompt: "",
        senders: ["mail@example.com"],
      };
      const candidate = {
        autoLabel,
        description: null,
        id: "deterministic",
        inclusionCriteria: null,
        name: "Sender",
      };
      await retryPendingAutomationMessages({
        ...input,
        automationRuntime: {
          ...input.automationRuntime,
          getAutoLabelContext: async () => ({
            availableLabelIds: new Set(["deterministic", "ai"]),
            historyLabels: [],
            labels: [
              candidate,
              ...(mixed
                ? [
                    {
                      ...candidate,
                      autoLabel: { ...autoLabel, prompt: "Only invoices" },
                      id: "ai",
                    },
                  ]
                : []),
            ],
            memoryCandidates: {
              mailboxId: "mailbox-1",
              userId: "user-1",
            },
            model: "fixture-model",
          }),
        },
      });
      expect(
        fixtures.mutate.mock.calls.flatMap((call) =>
          typeof call[2] === "string" ? [] : (call[2].addLabelIds ?? [])
        )
      ).toContain("deterministic");
      expect(fixtures.classify).not.toHaveBeenCalled();
      expect(event.appliedAt instanceof Date).toBe(!mixed);
      expect(event.labelIds).toStrictEqual(mixed ? null : ["deterministic"]);
      expect(event.nextAttemptAt instanceof Date).toBe(mixed);
      expect(event.usageReportedAt instanceof Date).toBe(!mixed);
      expect(fixtures.budget).toHaveBeenCalledTimes(Number(mixed));
    }
  );

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

  test("schedules unfinished capture independently of automation failure backoff", async () => {
    Object.assign(fixtures.rows[0] ?? {}, { attemptCount: 1 });
    Object.assign(fixtures.mailboxes[0] ?? {}, {
      lastErrorAt: new Date(),
      phase: "bootstrap",
    });

    const jobs = await listGmailPubSubMaintenanceJobs();

    expect(jobs.some((job) => job.mailboxId === input.mailboxId)).toBeTruthy();
  });
});
