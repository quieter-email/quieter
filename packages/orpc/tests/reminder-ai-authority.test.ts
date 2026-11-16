import { ORPCError } from "@orpc/server";
import type {
  evaluateReminderCondition,
  extractReminderSuggestion,
} from "@quieter/ai/reminders";
import type { reportAiUsage } from "@quieter/billing";
import type { createMailboxAiBillingContext } from "@quieter/billing/ai-reservation";
import { db } from "@quieter/database/client";
import type {
  mailReminder,
  mailReminderJob,
  mailReminderSuggestion,
} from "@quieter/database/schema";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { Mock } from "vite-plus/test";

import type { assertCanUseAi } from "../src/ai-access";
import type { captureAiOrigin } from "../src/ai-authority";
import type { getMailAutomationAiBudgetStatus } from "../src/mail-automation/ai-budget";
import type { publishMailUpdate } from "../src/mail-updates";
import * as ReminderPersistenceModule from "../src/reminders/persistence";
import { processReminderJobs } from "../src/reminders/runtime";
import type { materializeSentReminder } from "../src/reminders/sent";
import type * as ReminderSuggestionStoreModule from "../src/reminders/suggestion-store";
import type * as ReminderSuggestionsModule from "../src/reminders/suggestions";

type ReminderFixtures = {
  domainWrites: Record<string, unknown>[];
  capture: Mock<typeof captureAiOrigin>;
  createReminder: Mock<() => Promise<{ id: string }>>;
  evaluate: Mock<typeof evaluateReminderCondition>;
  extract: Mock<typeof extractReminderSuggestion>;
  job: typeof mailReminderJob.$inferSelect | undefined;
  jobAdmissions: Record<string, unknown>[];
  paused: boolean;
  policyVersion: number;
  publish: Mock<typeof publishMailUpdate>;
  readOnly: boolean;
  reminder: typeof mailReminder.$inferSelect | undefined;
  suggestion: typeof mailReminderSuggestion.$inferSelect | undefined;
  suggestionWrites: Record<string, unknown>[];
  suggestionStatusWrites: string[];
  usageWrites: Record<string, unknown>[];
};

const fixtures = vi.hoisted<ReminderFixtures>(() => ({
  capture: vi.fn<typeof captureAiOrigin>(),
  createReminder: vi.fn<() => Promise<{ id: string }>>(),
  domainWrites: [],
  evaluate: vi.fn<typeof evaluateReminderCondition>(),
  extract: vi.fn<typeof extractReminderSuggestion>(),
  job: undefined,
  jobAdmissions: [],
  paused: false,
  policyVersion: 1,
  publish: vi.fn<typeof publishMailUpdate>(),
  readOnly: false,
  reminder: undefined,
  suggestion: undefined,
  suggestionStatusWrites: [],
  suggestionWrites: [],
  usageWrites: [],
}));

vi.mock(import("../src/ai-authority"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    aiOriginSchema: actual.aiOriginSchema,
    assertAiAuthority: async (input) => {
      if (
        input.origin.kind === "ai" &&
        ((fixtures.paused && input.origin.mode === "automation") ||
          fixtures.readOnly ||
          fixtures.policyVersion !== input.origin.policyVersion)
      ) {
        throw new ORPCError("FORBIDDEN", {
          data: { aiAuthorityReason: "policy_changed" },
        });
      }
      await Promise.resolve();
    },
    captureAiOrigin: fixtures.capture,
  };
});

// oxlint-disable-next-line vitest/prefer-import-in-mock -- This database fake implements the reminder runtime's query and write boundaries.
vi.mock("@quieter/database/client", async () => {
  const { getTableName } = await import("drizzle-orm");
  const database = {
    insert: (table: Parameters<typeof getTableName>[0]) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: () => {
          if (
            getTableName(table) === "mailReminderJob" &&
            !fixtures.jobAdmissions.some(
              (job) => job.operationKey === values.operationKey
            )
          ) {
            fixtures.jobAdmissions.push(values);
          }
          return {
            returning: () => [{ ...fixtures.reminder, ...values }],
          };
        },
      }),
    }),
    select: () => ({
      from: (table: Parameters<typeof getTableName>[0]) => {
        const name = getTableName(table);
        let rows: unknown[] = [];
        if (name === "mailReminder") {
          rows = [fixtures.reminder];
        } else if (name === "mailbox") {
          rows = [{ email: "owner@example.test" }];
        } else if (name === "mailReminderPreference") {
          rows = [{ automatic: true, suggestions: true, timeZone: "UTC" }];
        } else if (
          name === "mailReminderSuggestion" &&
          fixtures.suggestion !== undefined
        ) {
          rows = [fixtures.suggestion];
        }
        const query = {
          for: () => (name === "mailReminderJob" ? [fixtures.job] : rows),
          innerJoin: () => query,
          limit: () => rows,
          orderBy: () => query,
          where: () => query,
        };
        return query;
      },
    }),
    update: (table: Parameters<typeof getTableName>[0]) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (getTableName(table) === "mailReminder") {
            fixtures.domainWrites.push(values);
          } else if ("usage" in values) {
            fixtures.usageWrites.push(values);
          }
          if (
            getTableName(table) === "mailReminderSuggestion" &&
            "result" in values
          ) {
            fixtures.suggestionWrites.push(values);
          }
          if (
            getTableName(table) === "mailReminderSuggestion" &&
            typeof values.status === "string"
          ) {
            fixtures.suggestionStatusWrites.push(values.status);
          }
          return {
            returning: () => {
              if (getTableName(table) === "mailReminder") {
                return [fixtures.reminder];
              }
              if (getTableName(table) === "mailReminderSuggestion") {
                return [{ ...fixtures.suggestion, ...values }];
              }
              return [{ id: "job" }];
            },
          };
        },
      }),
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

vi.mock(import("@quieter/ai/reminders"), () => ({
  evaluateReminderCondition: fixtures.evaluate,
  extractReminderSuggestion: fixtures.extract,
}));
vi.mock(import("@quieter/billing"), () => ({
  reportAiUsage: vi.fn<typeof reportAiUsage>(),
}));
vi.mock(import("@quieter/billing/ai-reservation"), () => ({
  createMailboxAiBillingContext: vi
    .fn<typeof createMailboxAiBillingContext>()
    .mockResolvedValue({
      account: null,
      admittedAt: new Date(),
      groupId: "reply-check",
      kind: "team",
      organizationId: "organization",
      usageKind: "mailAction",
    }),
}));
vi.mock(import("../src/ai-access"), () => ({
  assertCanUseAi: vi.fn<typeof assertCanUseAi>(),
}));
vi.mock(import("../src/mail-automation/ai-budget"), () => ({
  getMailAutomationAiBudgetStatus: vi
    .fn<typeof getMailAutomationAiBudgetStatus>()
    .mockResolvedValue({ allowed: true, reason: "allowed" }),
}));
vi.mock(import("../src/mail-updates"), () => ({
  publishMailUpdate: fixtures.publish,
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The clock boundary supplies only the authorized scope consumed by evaluation.
vi.mock("../src/reminders/clock", () => ({
  advanceReminderScope: vi.fn<() => Promise<void>>(),
  assertReminderScopeAccess: vi
    .fn<() => Promise<{ organizationId: string }>>()
    .mockResolvedValue({
      organizationId: "organization",
    }),
  reconcileReminderSchedules: vi.fn<() => Promise<void>>(),
}));
vi.mock(import("../src/reminders/persistence"), () => ({
  claimReminderJob: vi.fn<typeof ReminderPersistenceModule.claimReminderJob>(
    async () =>
      await Promise.resolve(
        fixtures.job !== undefined && fixtures.reminder !== undefined
          ? {
              job: fixtures.job,
              reminder: fixtures.reminder,
              token: "00000000-0000-4000-8000-000000000001",
            }
          : null
      )
  ),
  finishReminderJob:
    vi.fn<typeof ReminderPersistenceModule.finishReminderJob>(),
}));
vi.mock(import("../src/reminders/sent"), () => ({
  materializeSentReminder: vi.fn<typeof materializeSentReminder>(),
}));
vi.mock(import("../src/reminders/suggestions"), () => ({
  processReminderSuggestions: vi
    .fn<typeof ReminderSuggestionsModule.processReminderSuggestions>()
    .mockResolvedValue(0),
}));
vi.mock(import("../src/reminders/suggestion-store"), () => ({
  claimReminderSuggestion: vi.fn<
    typeof ReminderSuggestionStoreModule.claimReminderSuggestion
  >(
    async () =>
      await Promise.resolve(
        fixtures.suggestion === undefined
          ? null
          : {
              row: fixtures.suggestion,
              token: "00000000-0000-4000-8000-000000000001",
            }
      )
  ),
  enqueueReminderSuggestion:
    vi.fn<typeof ReminderSuggestionStoreModule.enqueueReminderSuggestion>(),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The authorized mailbox boundary exposes only the organization used by this processor.
vi.mock("../src/mailbox/service", () => ({
  assertAccessibleMailbox: vi
    .fn<() => Promise<{ organizationId: string }>>()
    .mockResolvedValue({ organizationId: "organization" }),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Reminder creation is the domain effect being fenced by the suggestion processor.
vi.mock("../src/reminders/service", () => ({
  createReminder: fixtures.createReminder,
  getReminder: vi.fn<() => Promise<void>>(),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Mail content is mocked at the read transport boundary.
vi.mock("../src/mail/queries", () => ({
  queriesMailOperations: {
    getThread: vi.fn<() => Promise<unknown>>().mockResolvedValue({
      messages: [
        { from: "owner@example.test", id: "anchor", internalDate: "1000" },
        {
          bodyText: "The requested report is attached.",
          from: "sender@example.test",
          id: "reply",
          internalDate: "2000",
        },
      ],
      threadId: "private-thread",
    }),
  },
}));

describe("automatic reminder authority", () => {
  beforeEach(() => {
    const now = new Date();
    fixtures.paused = false;
    fixtures.readOnly = false;
    fixtures.policyVersion = 1;
    fixtures.capture.mockReset().mockImplementation(
      async (input) =>
        await Promise.resolve({
          ...input,
          kind: "ai",
          policyVersion: fixtures.policyVersion,
        })
    );
    vi.mocked(ReminderPersistenceModule.finishReminderJob).mockClear();
    fixtures.jobAdmissions.length = 0;
    fixtures.domainWrites.length = 0;
    fixtures.usageWrites.length = 0;
    fixtures.suggestionWrites.length = 0;
    fixtures.suggestionStatusWrites.length = 0;
    fixtures.createReminder
      .mockReset()
      .mockResolvedValue({ id: "created-reminder" });
    fixtures.extract.mockReset().mockResolvedValue({ suggestion: null });
    fixtures.publish.mockClear();
    fixtures.evaluate.mockReset().mockResolvedValue({
      evidenceMessageIds: ["reply"],
      explanation: "The requested report arrived.",
      kind: "fulfilled",
    });
    fixtures.reminder = {
      createdAt: now,
      dueAt: now,
      evaluationStatus: "pending",
      evaluationSummary: null,
      firedAt: null,
      id: "private-reminder",
      mailboxId: "private-mailbox",
      requestId: "private-request",
      resolution: null,
      scheduleVersion: 1,
      source: null,
      status: "active",
      target: {
        anchorMessageId: "anchor",
        condition: "The requested report arrives",
        kind: "thread",
        threadId: "private-thread",
      },
      threadId: "private-thread",
      timeZone: "UTC",
      title: "Follow up",
      updatedAt: now,
      userId: "owner",
      version: 1,
    };
    fixtures.job = {
      attempts: 1,
      authorityVersion: 1,
      availableAt: now,
      completedAt: null,
      createdAt: now,
      eventId: "event",
      id: "job",
      kind: "evaluate",
      leaseToken: "00000000-0000-4000-8000-000000000001",
      leaseUntil: new Date(now.getTime() + 60_000),
      operationKey: "private-operation",
      reminderId: "private-reminder",
      reminderVersion: 1,
      scheduleVersion: 1,
      usage: null,
      usageModel: null,
      usageReportedAt: null,
    };
    fixtures.suggestion = {
      attempts: 1,
      authorityVersion: 1,
      automatic: true,
      availableAt: now,
      createdAt: now,
      fingerprint: null,
      id: "private-suggestion",
      leaseToken: "00000000-0000-4000-8000-000000000001",
      leaseUntil: new Date(now.getTime() + 60_000),
      mailboxId: "private-mailbox",
      messageId: "reply",
      reminderId: null,
      result: null,
      status: "pending",
      threadId: "private-thread",
      timeZone: "UTC",
      usage: null,
      usageModel: null,
      usageReportedAt: null,
      userId: "owner",
    };
  });

  test("does not run a private reply check while automation is paused", async () => {
    fixtures.paused = true;
    await processReminderJobs({ limit: 1 });
    expect(fixtures.evaluate).not.toHaveBeenCalled();
    expect(fixtures.domainWrites).toHaveLength(0);
    expect(fixtures.publish).not.toHaveBeenCalled();
  });

  test("does not apply an in-flight result after a policy change, while retaining its usage", async () => {
    fixtures.evaluate.mockImplementation(async (input) => {
      await Promise.resolve();
      input.onUsage?.({
        cacheWriteTokens: 0,
        cachedTokens: 0,
        completionTokens: 5,
        costUsd: 0,
        promptTokens: 20,
      });
      fixtures.policyVersion += 2;
      return {
        evidenceMessageIds: ["reply"],
        explanation: "The requested report arrived.",
        kind: "fulfilled",
      };
    });
    await processReminderJobs({ limit: 1 });
    expect(fixtures.evaluate).toHaveBeenCalledOnce();
    expect(fixtures.domainWrites).toHaveLength(0);
    expect(fixtures.usageWrites).not.toHaveLength(0);
    expect(fixtures.publish).not.toHaveBeenCalled();
  });

  test("read-only leaves the private reminder unchanged", async () => {
    fixtures.readOnly = true;
    await processReminderJobs({ limit: 1 });
    expect(fixtures.evaluate).not.toHaveBeenCalled();
    expect(fixtures.domainWrites).toHaveLength(0);
    expect(fixtures.publish).not.toHaveBeenCalled();
  });

  test("applies a current authorized reply result to its private reminder", async () => {
    await processReminderJobs({ limit: 1 });
    expect(fixtures.evaluate).toHaveBeenCalledOnce();
    expect(fixtures.domainWrites).toMatchObject([{ status: "completed" }]);
    expect(fixtures.publish).toHaveBeenCalledOnce();
  });

  test.each([false, true])(
    "does not revive an old queued reply check after pause and resume, cached result %s",
    async (cached) => {
      if (!fixtures.job) {
        throw new Error("Missing reminder job fixture.");
      }
      fixtures.policyVersion = 3;
      fixtures.job.attempts = 2;
      if (cached) {
        fixtures.job.usageModel = "saved-model";
        fixtures.job.usage = {
          cacheWriteTokens: 0,
          cachedTokens: 0,
          completionTokens: 5,
          promptTokens: 20,
          result: {
            evidenceMessageIds: ["reply"],
            explanation: "The requested report arrived.",
            kind: "fulfilled",
          },
        };
      }
      await processReminderJobs({ limit: 1 });
      expect(fixtures.evaluate).not.toHaveBeenCalled();
      expect(fixtures.domainWrites).toHaveLength(0);
      expect(fixtures.publish).not.toHaveBeenCalled();
      expect(ReminderPersistenceModule.finishReminderJob).toHaveBeenCalledWith(
        expect.objectContaining({ id: "job", retry: false })
      );
    }
  );

  test("finishes an unversioned legacy reply check without changing the human reminder", async () => {
    if (!fixtures.job) {
      throw new Error("Missing reminder job fixture.");
    }
    fixtures.job.authorityVersion = null;
    await processReminderJobs({ limit: 1 });
    expect(fixtures.evaluate).not.toHaveBeenCalled();
    expect(fixtures.domainWrites).toHaveLength(0);
    expect(fixtures.publish).not.toHaveBeenCalled();
    expect(ReminderPersistenceModule.finishReminderJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job" })
    );
  });

  test("runs a newly admitted reply check after automation resumes", async () => {
    if (!fixtures.job) {
      throw new Error("Missing reminder job fixture.");
    }
    fixtures.policyVersion = 3;
    fixtures.job.authorityVersion = 3;
    await processReminderJobs({ limit: 1 });
    expect(fixtures.evaluate).toHaveBeenCalledOnce();
    expect(fixtures.domainWrites).toMatchObject([{ status: "completed" }]);
  });

  test("admits evaluation through the supplied transaction and preserves its original version on retry", async () => {
    if (!fixtures.reminder) {
      throw new Error("Missing reminder fixture.");
    }
    const persistence = await vi.importActual<typeof ReminderPersistenceModule>(
      "../src/reminders/persistence"
    );
    const transaction = new Proxy(db, {});
    fixtures.capture.mockImplementation(async (input, database) => {
      if (database !== transaction) {
        throw new Error("Authority capture escaped the admission transaction.");
      }
      return await Promise.resolve({
        ...input,
        kind: "ai",
        policyVersion: fixtures.policyVersion,
      });
    });
    await persistence.enqueueReminderJob(
      transaction,
      fixtures.reminder,
      "evaluate",
      "same-incoming-event"
    );
    fixtures.policyVersion = 3;
    await persistence.enqueueReminderJob(
      transaction,
      fixtures.reminder,
      "evaluate",
      "same-incoming-event"
    );
    await persistence.enqueueReminderJob(
      transaction,
      fixtures.reminder,
      "evaluate",
      "new-incoming-event"
    );
    expect(fixtures.jobAdmissions).toHaveLength(2);
    expect(
      fixtures.jobAdmissions.map((job) => job.authorityVersion)
    ).toStrictEqual([1, 3]);
  });

  test.each(["paused", "read-only", "inaccessible", "suspended"])(
    "preserves human reminder creation and its deterministic schedule when %s",
    async (state) => {
      if (!fixtures.reminder) {
        throw new Error("Missing reminder fixture.");
      }
      fixtures.paused = state === "paused";
      fixtures.readOnly = state === "read-only";
      if (state === "inaccessible") {
        fixtures.capture.mockRejectedValue(
          new ORPCError("NOT_FOUND", { message: "Mailbox not found." })
        );
      }
      const persistence = await vi.importActual<
        typeof ReminderPersistenceModule
      >("../src/reminders/persistence");
      const reminder = await persistence.createReminderRecord({
        dueAt: fixtures.reminder.dueAt.toISOString(),
        mailboxId: fixtures.reminder.mailboxId,
        origin: { kind: "human" },
        requestId: fixtures.reminder.requestId,
        suspended: state === "suspended",
        target: fixtures.reminder.target,
        timeZone: fixtures.reminder.timeZone,
        title: fixtures.reminder.title,
        userId: fixtures.reminder.userId,
      });
      expect(reminder.status).toBe(
        state === "suspended" ? "suspended" : "active"
      );
      expect(fixtures.jobAdmissions).toMatchObject([
        { authorityVersion: null, kind: "schedule" },
      ]);
      expect(fixtures.jobAdmissions).toHaveLength(1);
    }
  );

  test("does not extract an automatic suggestion while paused", async () => {
    fixtures.paused = true;
    const suggestions = await vi.importActual<typeof ReminderSuggestionsModule>(
      "../src/reminders/suggestions"
    );
    await suggestions.processReminderSuggestions({ limit: 1 });
    expect(fixtures.extract).not.toHaveBeenCalled();
    expect(fixtures.suggestionWrites).toHaveLength(0);
    expect(fixtures.createReminder).not.toHaveBeenCalled();
  });

  test.each([
    { automatic: true, mode: "interactive" },
    { automatic: false, mode: "automation" },
  ] as const)(
    "cannot admit automatic suggestion work as interactive while paused, %o",
    async ({ automatic, mode }) => {
      fixtures.paused = true;
      const store = await vi.importActual<typeof ReminderSuggestionStoreModule>(
        "../src/reminders/suggestion-store"
      );
      await expect(
        store.enqueueReminderSuggestion({
          automatic,
          mailboxId: "private-mailbox",
          messageId: "reply",
          origin: {
            kind: "ai",
            mailboxId: "private-mailbox",
            mode,
            policyVersion: 1,
            userId: "owner",
          },
          threadId: "private-thread",
          timeZone: "UTC",
          userId: "owner",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(fixtures.suggestionWrites).toHaveLength(0);
      expect(fixtures.createReminder).not.toHaveBeenCalled();
    }
  );

  test.each([null, 0])(
    "retires an old pending suggestion without extracting or creating a reminder, version %s",
    async (authorityVersion) => {
      if (!fixtures.suggestion) {
        throw new Error("Missing suggestion fixture.");
      }
      fixtures.suggestion.authorityVersion = authorityVersion;
      const suggestions = await vi.importActual<
        typeof ReminderSuggestionsModule
      >("../src/reminders/suggestions");
      await suggestions.processReminderSuggestions({ limit: 1 });
      expect(fixtures.extract).not.toHaveBeenCalled();
      expect(fixtures.suggestionWrites).toHaveLength(0);
      expect(fixtures.suggestionStatusWrites).toContain("none");
      expect(fixtures.createReminder).not.toHaveBeenCalled();
    }
  );

  test("does not apply a cached automatic suggestion after pause and resume", async () => {
    if (!fixtures.suggestion) {
      throw new Error("Missing suggestion fixture.");
    }
    fixtures.policyVersion = 3;
    fixtures.suggestion.attempts = 2;
    fixtures.suggestion.result = {
      automaticEligible: true,
      condition: null,
      confidence: "clear",
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      reason: "A deadline needs a follow-up.",
      title: "Follow up",
    };
    const suggestions = await vi.importActual<typeof ReminderSuggestionsModule>(
      "../src/reminders/suggestions"
    );
    await suggestions.processReminderSuggestions({ limit: 1 });
    expect(fixtures.extract).not.toHaveBeenCalled();
    expect(fixtures.suggestionStatusWrites).toContain("none");
    expect(fixtures.createReminder).not.toHaveBeenCalled();
  });

  test("allows a human to accept an already published legacy suggestion under read-only", async () => {
    if (!fixtures.suggestion) {
      throw new Error("Missing suggestion fixture.");
    }
    fixtures.readOnly = true;
    fixtures.paused = true;
    fixtures.suggestion.authorityVersion = null;
    fixtures.suggestion.status = "suggested";
    fixtures.suggestion.leaseToken = null;
    fixtures.suggestion.leaseUntil = null;
    fixtures.suggestion.result = {
      automaticEligible: true,
      condition: null,
      confidence: "clear",
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      reason: "A deadline needs a follow-up.",
      title: "Follow up",
    };
    const suggestions = await vi.importActual<typeof ReminderSuggestionsModule>(
      "../src/reminders/suggestions"
    );
    const reminder = await suggestions.acceptReminderSuggestion({
      mailboxId: fixtures.suggestion.mailboxId,
      suggestionId: fixtures.suggestion.id,
      userId: fixtures.suggestion.userId,
    });
    expect(reminder).toMatchObject({ id: "created-reminder" });
    expect(fixtures.createReminder.mock.calls).toMatchObject([
      [{ origin: undefined, source: { kind: "suggestion" } }],
    ]);
  });

  test("retains extraction usage without publishing a suggestion after permissions change", async () => {
    fixtures.extract.mockImplementation(async (input) => {
      input.onUsage({
        cacheWriteTokens: 0,
        cachedTokens: 0,
        completionTokens: 5,
        costUsd: 0,
        promptTokens: 20,
      });
      fixtures.policyVersion += 2;
      return await Promise.resolve({
        suggestion: {
          actionEvidence: "report",
          condition: null,
          confidence: "clear",
          deadlineEvidence: "attached",
          dueAt: new Date(Date.now() + 86_400_000).toISOString(),
          explicitInstant: true,
          reason: "A deadline needs a follow-up.",
          title: "Follow up",
        },
      });
    });
    const suggestions = await vi.importActual<typeof ReminderSuggestionsModule>(
      "../src/reminders/suggestions"
    );
    await suggestions.processReminderSuggestions({ limit: 1 });
    expect(fixtures.extract).toHaveBeenCalledOnce();
    expect(fixtures.suggestionWrites).toHaveLength(0);
    expect(fixtures.usageWrites).not.toHaveLength(0);
    expect(fixtures.createReminder).not.toHaveBeenCalled();
  });
});
