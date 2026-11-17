/* oxlint-disable eslint/require-await -- Provider and persistence doubles keep asynchronous contracts without external I/O. */
import { AUTO_LABEL_MODEL } from "@quieter/ai/classify-gmail-message";
import type { classifyMailMessage } from "@quieter/ai/classify-gmail-message";
import { AiCreditAdmissionBusyError } from "@quieter/billing/ai-credit-errors";
import type { createMailboxAiBillingContext } from "@quieter/billing/ai-reservation";
import type { hasUserBillingFeature } from "@quieter/billing/entitlements";
import type { getMessageWithDetails, mutateGmailMessage } from "@quieter/gmail";
import type * as Drizzle from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type {
  loadAiAgentContext,
  loadAiAgentMemoryCandidates,
} from "../src/ai-memory";
import { REQUIRED_GMAIL_SCOPES } from "../src/gmail-mailbox-access";
import { processGmailMessage } from "../src/gmail-sync/message";
import type { getMailAutomationAiBudgetStatus } from "../src/mail-automation/ai-budget";
import { MAIL_AUTOMATION_AI_PAUSED_MESSAGE } from "../src/mail-automation/ai-budget";
import { deferAutoLabelAutomation } from "../src/mail-automation/auto-label-events";
import type { loadMailAutoLabelHistory } from "../src/mail-automation/history";
import { runReceiveStage } from "../src/mail-receive";
import type { ReceiveStageOutcome } from "../src/mail-receive";
import { processManagedMailAutomation } from "../src/managed-mail/automation";
import type { updateManagedMessageLabelAssignments } from "../src/managed-mail/labels/repository";

type Row = Record<string, unknown>;
type Predicate = (row: Row) => boolean;
const state = vi.hoisted(() => ({
  budget: vi.fn<typeof getMailAutomationAiBudgetStatus>(),
  classify: vi.fn<typeof classifyMailMessage>(),
  entitlement: vi.fn<typeof hasUserBillingFeature>(),
  gmailDispatched: [] as string[],
  gmailMessage: vi.fn<typeof getMessageWithDetails>(),
  gmailPrepare: vi.fn<() => Promise<void>>(),
  gmailWrite: vi.fn<typeof mutateGmailMessage>(),
  history: vi.fn<typeof loadMailAutoLabelHistory>(),
  labels: vi.fn<typeof updateManagedMessageLabelAssignments>(),
  memoryContext: vi.fn<typeof loadAiAgentContext>(),
  memoryUserId: null as string | null,
  shared: false,
  tables: new Map<string, Row[]>(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Evaluate the native retry predicates against independent persisted rows.
vi.mock("drizzle-orm", async (original) => ({
  ...(await original<typeof Drizzle>()),
  and:
    (...predicates: (Predicate | undefined)[]) =>
    (row: Row) =>
      predicates.every((predicate) => predicate?.(row) ?? true),
  eq: (column: { name: string }, value: unknown) => (row: Row) =>
    row[column.name] === value,
  inArray: (column: { name: string }, values: unknown[]) => (row: Row) =>
    values.includes(row[column.name]),
  isNotNull: (column: { name: string }) => (row: Row) =>
    row[column.name] !== null,
  isNull: (column: { name: string }) => (row: Row) => row[column.name] === null,
  lte: (column: { name: string }, value: Date) => (row: Row) => {
    const current = row[column.name];
    return current instanceof Date && current <= value;
  },
  or:
    (...predicates: Predicate[]) =>
    (row: Row) =>
      predicates.some((predicate) => predicate(row)),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The fake saves native event transitions and returns the persisted row's requested fields.
vi.mock("@quieter/database/client", async () => {
  const { getTableName } = await import("drizzle-orm");
  type Table = Parameters<typeof getTableName>[0];
  type Fields = Record<string, { name: string }>;
  const build = (
    table: Table,
    operation: "insert" | "select" | "update",
    values?: Row,
    fields?: Fields
  ) => {
    let predicate: Predicate | undefined;
    let limit = Number.POSITIVE_INFINITY;
    let projection = fields;
    const query = {
      for: () => query,
      innerJoin: () => query,
      leftJoin: () => query,
      limit: (next: number) => {
        limit = next;
        return query;
      },
      onConflictDoNothing: () => query,
      orderBy: () => query,
      returning: (next?: Fields) => {
        projection = next;
        return query;
      },
      // oxlint-disable-next-line unicorn/no-thenable -- Awaiting Drizzle executes the query.
      then: (fulfilled: (rows: Row[]) => unknown) => {
        const name = getTableName(table);
        const rows = state.tables.get(name) ?? [];
        state.tables.set(name, rows);
        if (
          operation === "insert" &&
          values !== undefined &&
          !rows.some(
            (row) =>
              row.mailboxId === values.mailboxId &&
              row.gmailMessageId === values.gmailMessageId
          )
        ) {
          rows.push({
            appliedAt: null,
            attemptCount: 0,
            authorityVersion: null,
            labelIds: null,
            lastError: null,
            model: null,
            nextAttemptAt: null,
            privateContextUserId: null,
            usageReportedAt: null,
            ...values,
          });
        }
        const selected = rows
          .filter((row) => predicate?.(row) ?? true)
          .slice(0, limit);
        if (operation === "update" && values !== undefined) {
          for (const row of selected) {
            Object.assign(row, values);
          }
        }
        return fulfilled(
          selected.map((row) =>
            projection === undefined
              ? row
              : Object.fromEntries(
                  Object.entries(projection).map(([key, column]) => [
                    key,
                    row[column.name],
                  ])
                )
          )
        );
      },
      where: (next: Predicate) => {
        predicate = next;
        return query;
      },
    };
    return query;
  };
  const operations = {
    insert: (table: Table) => ({
      values: (values: Row) => build(table, "insert", values),
    }),
    select: (fields?: Fields) => ({
      from: (table: Table) => build(table, "select", undefined, fields),
    }),
    update: (table: Table) => ({
      set: (values: Row) => build(table, "update", values),
    }),
  };
  return {
    db: {
      ...operations,
      transaction: async <Result>(
        run: (transaction: typeof operations) => Promise<Result>
      ) => await run(operations),
    },
  };
});

vi.mock(import("@quieter/ai/classify-gmail-message"), async (original) => ({
  ...(await original()),
  classifyMailMessage: state.classify,
}));
vi.mock(import("@quieter/billing/entitlements"), () => ({
  hasUserBillingFeature: state.entitlement,
}));
vi.mock(import("@quieter/billing/ai-reservation"), () => ({
  createMailboxAiBillingContext: vi.fn<typeof createMailboxAiBillingContext>(),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The fake selects the receive context overload without unrelated memory APIs.
vi.mock("../src/ai-memory", async () => {
  const { buildMailMemoryQuery, serializeAiAgentContext } =
    await import("../src/ai-memory-context");
  return {
    buildMailMemoryQuery,
    loadAiAgentContext: state.memoryContext,
    loadAiAgentMemoryCandidates: async (
      input: Parameters<typeof loadAiAgentMemoryCandidates>[0]
    ) => ({ mailboxId: input.mailboxId, userId: input.userId }),
    loadAiConfiguration: () => ({ autoLabelModel: AUTO_LABEL_MODEL }),
    serializeAiAgentContext,
  };
});
vi.mock(import("../src/ai-memory-capture"), () => ({
  captureMailboxMessageMemory: async () => null,
  getMailboxMemoryActor: async () =>
    state.memoryUserId === null ? null : { userId: state.memoryUserId },
}));
vi.mock(import("../src/mail-automation/ai-budget"), async (original) => ({
  ...(await original()),
  getMailAutomationAiBudgetStatus: state.budget,
}));
vi.mock(import("../src/mail-automation/history"), () => ({
  loadMailAutoLabelHistory: state.history,
  loadManagedAutomationLabelHistory: async () => null,
}));
vi.mock(import("../src/mail-automation/usage"), () => ({
  reportAutoLabelUsage: async () => {},
}));
vi.mock(import("../src/managed-mail/labels/repository"), () => ({
  updateManagedMessageLabelAssignments: state.labels,
}));
vi.mock(import("@quieter/observability"), async (original) => ({
  ...(await original()),
  reportError: () => {},
}));

vi.mock(import("@quieter/gmail"), async (original) => ({
  ...(await original()),
  getMessageWithDetails: state.gmailMessage,
  mutateGmailMessage: state.gmailWrite,
}));
vi.mock(import("../src/mail-agent/access"), () => ({
  assertAgentMailboxAccess: async () => ({
    canSaveDraft: true,
    memberId: "member",
    organizationId: "team",
    provider: "gmail" as const,
    shared: state.shared,
  }),
}));

const identity = { mailboxId: "private-mailbox", messageId: "private-message" };

describe("receive stage invocation", () => {
  test("preflight abort prevents invocation without a durable cancellation", async () => {
    const controller = new AbortController();
    const reason = new Error("Caller stopped before invocation");
    controller.abort(reason);
    const execute = vi.fn<() => Promise<ReceiveStageOutcome<"auto_label">>>();
    const diagnostics: string[] = [];

    await expect(
      runReceiveStage({
        execute,
        identity,
        onAttempt: (attempt) => {
          diagnostics.push(JSON.stringify(attempt));
        },
        signal: controller.signal,
        stage: "auto_label",
      })
    ).rejects.toBe(reason);
    expect(execute).not.toHaveBeenCalled();
    expect(diagnostics.join(",")).not.toContain(identity.mailboxId);
    expect(diagnostics.join(",")).not.toContain(identity.messageId);
    expect(diagnostics.join(",")).toContain("not_started");
  });

  test("observer failure preserves the owner's retry and saved deadline", async () => {
    const outcome: ReceiveStageOutcome<"auto_label"> = {
      reason: "failure",
      retryAt: new Date(Date.now() + 60_000),
      status: "retry",
    };
    const result = await runReceiveStage({
      execute: async () => outcome,
      identity,
      onAttempt: () => {
        throw new Error("Diagnostic sink failed");
      },
      stage: "auto_label",
    });
    expect(result).toBe(outcome);
  });

  test("observer failure preserves the original processing failure", async () => {
    const failure = new Error("Owner failed");
    await expect(
      runReceiveStage({
        execute: async () => {
          throw failure;
        },
        identity,
        onAttempt: () => {
          throw new Error("Diagnostic sink failed");
        },
        stage: "auto_label",
      })
    ).rejects.toBe(failure);
  });

  test.each(["complete", "needs_attention"] as const)(
    "late abort preserves an owner's %s effect outcome",
    async (status) => {
      const controller = new AbortController();
      const result = await runReceiveStage({
        execute: async () => {
          controller.abort();
          return { status };
        },
        identity: { ...identity, actorUserId: "actor", runId: "run" },
        signal: controller.signal,
        stage: "personal_action",
      });
      expect(result.status).toBe(status);
    }
  );
});

describe("managed per-message receive outcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.tables.clear();
    state.memoryUserId = null;
    state.shared = false;
    state.tables.set("mailbox", [
      {
        billingOwnerUserId: "actor",
        id: "private-mailbox",
        organizationId: "team",
        provider: "managed",
      },
    ]);
    state.tables.set("mailboxAutomationSettings", [
      { autoLabelEnabled: true, mailboxId: "private-mailbox" },
    ]);
    state.tables.set("managedMailLabel", [
      {
        autoLabel: null,
        id: "label",
        mailboxId: "private-mailbox",
        name: "Follow up",
      },
    ]);
    state.tables.set("managedMailMessage", [
      {
        createdAt: new Date(),
        direction: "inbound",
        from: "sender@example.test",
        headers: [],
        id: "private-message",
        isRead: false,
        mailboxId: "private-mailbox",
        mailboxState: "active",
        threadId: "thread",
        to: "team@example.test",
      },
    ]);
    state.budget
      .mockReset()
      .mockResolvedValue({ allowed: true, reason: "allowed" });
    state.entitlement.mockReset().mockResolvedValue({
      account: null,
      hasAccess: true,
      hasUnlimitedAccess: true,
      product: "pro",
    });
    state.classify.mockReset().mockResolvedValue(["label"]);
    state.labels.mockReset().mockResolvedValue([]);
  });

  test("does not manufacture a checkpoint for disabled, missing-owner, or entitlement gates", async () => {
    state.tables.set("mailboxAutomationSettings", []);
    await expect(processManagedMailAutomation(identity)).resolves.toMatchObject(
      { reason: "disabled", status: "skipped" }
    );
    state.tables.set("mailboxAutomationSettings", [
      { autoLabelEnabled: true, mailboxId: identity.mailboxId },
    ]);
    state.tables.set("mailbox", []);
    await expect(processManagedMailAutomation(identity)).resolves.toMatchObject(
      { reason: "no_owner", status: "skipped" }
    );
    state.tables.set("mailbox", [
      {
        billingOwnerUserId: "actor",
        id: identity.mailboxId,
        organizationId: "team",
      },
    ]);
    state.entitlement.mockResolvedValue({
      account: null,
      hasAccess: false,
      hasUnlimitedAccess: false,
      product: null,
    });
    await expect(processManagedMailAutomation(identity)).resolves.toMatchObject(
      { reason: "not_entitled", status: "skipped" }
    );
    expect(state.tables.get("gmailAutoLabelEvent") ?? []).toHaveLength(0);
    expect(state.classify).not.toHaveBeenCalled();
  });

  test.each(["automationPaused", "readOnly"] as const)(
    "%s fences AI labels while deterministic rules remain available",
    async (flag) => {
      state.tables.set("mailboxAiAuthority", [
        {
          automationPaused: flag === "automationPaused",
          mailboxId: identity.mailboxId,
          readOnly: flag === "readOnly",
          version: 1,
        },
      ]);
      state.tables.get("managedMailLabel")?.push({
        autoLabel: {
          domains: [],
          enabled: true,
          keywordScope: "anywhere",
          keywords: [],
          matchMode: "all",
          prompt: "",
          senders: ["sender@example.test"],
        },
        id: "sender-rule",
        mailboxId: identity.mailboxId,
        name: "Known sender",
      });
      await expect(
        processManagedMailAutomation(identity)
      ).resolves.toMatchObject({ reason: "policy", status: "skipped" });
      expect(state.classify).not.toHaveBeenCalled();
      expect(state.labels).toHaveBeenCalledWith(
        expect.objectContaining({ addLabelIds: ["sender-rule"] })
      );
      expect(state.tables.get("mailboxAutomationSettings")).toMatchObject([
        { autoLabelEnabled: true },
      ]);
      expect(state.tables.get("gmailAutoLabelEvent")?.[0]?.labelIds).toBeNull();
    }
  );

  test("cached labels derived from personal context cannot be applied after the inbox becomes shared", async () => {
    state.memoryUserId = "memory-owner";
    state.memoryContext.mockResolvedValue({
      instructions: null,
      memory: "A private preference.",
    });
    state.labels.mockRejectedValueOnce(new Error("Application interrupted."));
    await expect(processManagedMailAutomation(identity)).resolves.toMatchObject(
      { status: "retry" }
    );
    const cached = state.tables.get("gmailAutoLabelEvent")?.[0];
    if (cached === undefined) {
      throw new Error("Expected the pending classification.");
    }
    state.shared = true;
    state.memoryUserId = null;
    cached.nextAttemptAt = new Date(Date.now() - 1);
    state.labels.mockClear();
    await expect(processManagedMailAutomation(identity)).resolves.toMatchObject(
      { reason: "policy", status: "skipped" }
    );
    expect(state.labels).not.toHaveBeenCalled();
    expect(cached.appliedAt).toBeNull();
  });

  test.each([null, 0])(
    "cached AI labels retain their admission epoch %s after policy is restored",
    async (authorityVersion) => {
      state.tables.set("gmailAutoLabelEvent", [
        {
          appliedAt: null,
          attemptCount: 0,
          authorityVersion,
          gmailMessageId: identity.messageId,
          id: "earlier-event",
          labelIds: ["label"],
          lastError: null,
          mailboxId: identity.mailboxId,
          model: AUTO_LABEL_MODEL,
          nextAttemptAt: null,
          privateContextUserId: null,
          usageReportedAt: new Date(),
        },
      ]);
      state.tables.set("mailboxAiAuthority", [
        {
          automationPaused: false,
          mailboxId: identity.mailboxId,
          readOnly: false,
          version: 2,
        },
      ]);
      await expect(
        processManagedMailAutomation(identity)
      ).resolves.toMatchObject({ reason: "policy", status: "skipped" });
      expect(state.labels).not.toHaveBeenCalled();
      expect(state.classify).not.toHaveBeenCalled();
      expect(
        state.tables.get("gmailAutoLabelEvent")?.[0]?.authorityVersion
      ).toBe(authorityVersion);
    }
  );

  test("a label disabled while classification runs cannot be applied from cached context", async () => {
    state.classify.mockImplementation(async () => {
      const label = state.tables.get("managedMailLabel")?.[0];
      if (label === undefined) {
        throw new Error("Expected the label fixture.");
      }
      label.autoLabel = { enabled: false };
      return ["label"];
    });
    await expect(processManagedMailAutomation(identity)).resolves.toMatchObject(
      { reason: "policy", status: "skipped" }
    );
    expect(state.labels).not.toHaveBeenCalled();
    expect(state.tables.get("gmailAutoLabelEvent")?.[0]?.labelIds).toBeNull();
  });

  test("a policy change while classification runs prevents result storage and label application", async () => {
    state.classify.mockImplementation(async ({ onUsage }) => {
      onUsage?.({
        cacheWriteTokens: 0,
        cachedTokens: 0,
        completionTokens: 1,
        costUsd: 0.001,
        promptTokens: 20,
      });
      state.tables.set("mailboxAiAuthority", [
        {
          automationPaused: true,
          mailboxId: identity.mailboxId,
          readOnly: false,
          version: 1,
        },
      ]);
      return ["label"];
    });
    await expect(processManagedMailAutomation(identity)).resolves.toMatchObject(
      { reason: "policy", status: "skipped" }
    );
    expect(state.labels).not.toHaveBeenCalled();
    const event = state.tables.get("gmailAutoLabelEvent")?.[0];
    expect(event?.labelIds).toBeNull();
    expect(event?.appliedAt).toBeNull();
    expect(event?.promptTokens).toBeGreaterThan(0);
  });

  test("retains a saved failure retry on duplicate arrival without another classification", async () => {
    state.classify.mockRejectedValueOnce(new Error("Temporary model failure"));
    const failed = await processManagedMailAutomation(identity);
    const [event] = state.tables.get("gmailAutoLabelEvent") ?? [];
    expect(failed).toMatchObject({
      reason: "failure",
      retryAt: event?.nextAttemptAt,
      status: "retry",
    });
    expect(event?.nextAttemptAt).toBeInstanceOf(Date);
    expect(event?.appliedAt).toBeNull();
    state.classify.mockClear();
    await expect(processManagedMailAutomation(identity)).resolves.toMatchObject(
      { retryAt: event?.nextAttemptAt, status: "retry" }
    );
    expect(state.classify).not.toHaveBeenCalled();
  });

  test("returns the admission owner's saved deadline and refuses duplicate early dispatch", async () => {
    state.classify.mockRejectedValueOnce(new AiCreditAdmissionBusyError());
    const deferred = await processManagedMailAutomation(identity);
    const [event] = state.tables.get("gmailAutoLabelEvent") ?? [];
    expect(deferred).toMatchObject({
      reason: "admission_busy",
      retryAt: event?.nextAttemptAt,
      status: "retry",
    });
    expect(event?.nextAttemptAt).toBeInstanceOf(Date);
    state.classify.mockClear();
    await expect(processManagedMailAutomation(identity)).resolves.toMatchObject(
      { retryAt: event?.nextAttemptAt, status: "retry" }
    );
    expect(state.classify).not.toHaveBeenCalled();
  });

  test("resumes budget-deferred work when its native budget allows before the saved deadline", async () => {
    state.budget.mockResolvedValue({
      allowed: false,
      message: MAIL_AUTOMATION_AI_PAUSED_MESSAGE,
      reason: "credits_exhausted",
    });
    const deferred = await processManagedMailAutomation(identity);
    const [event] = state.tables.get("gmailAutoLabelEvent") ?? [];
    expect(deferred).toMatchObject({
      reason: "budget",
      retryAt: event?.nextAttemptAt,
      status: "retry",
    });
    expect(state.classify).not.toHaveBeenCalled();
    state.budget.mockResolvedValue({ allowed: true, reason: "allowed" });
    await expect(processManagedMailAutomation(identity)).resolves.toMatchObject(
      { status: "complete" }
    );
    expect(event?.appliedAt).toBeInstanceOf(Date);
    expect(state.labels).toHaveBeenCalledWith(
      expect.objectContaining({ messageIds: [identity.messageId] })
    );
  });

  test("does not attribute another pending message's retry to the received message", async () => {
    const retryAt = new Date(Date.now() - 1000);
    state.tables.set("gmailAutoLabelEvent", [
      {
        appliedAt: null,
        attemptCount: 1,
        authorityVersion: 0,
        gmailMessageId: "backlog",
        id: "backlog-event",
        labelIds: null,
        lastError: "Temporary failure",
        mailboxId: identity.mailboxId,
        model: null,
        nextAttemptAt: retryAt,
        privateContextUserId: null,
        usageReportedAt: null,
      },
    ]);
    state.tables.get("managedMailMessage")?.push({
      createdAt: new Date(),
      direction: "inbound",
      headers: [],
      id: "backlog",
      mailboxId: identity.mailboxId,
      mailboxState: "active",
      threadId: "old-thread",
    });
    state.classify.mockImplementation(async ({ message }) => {
      if (message.id === "backlog") {
        throw new Error("Backlog failed");
      }
      return ["label"];
    });
    await expect(processManagedMailAutomation(identity)).resolves.toMatchObject(
      { status: "complete" }
    );
    const backlog = state.tables
      .get("gmailAutoLabelEvent")
      ?.find((event) => event.gmailMessageId === "backlog");
    expect(backlog?.appliedAt).toBeNull();
    expect(backlog?.nextAttemptAt).toBeInstanceOf(Date);
  });

  test("a missing retry owner cannot produce a claimed persisted retry", async () => {
    await expect(
      deferAutoLabelAutomation("missing-event", "Budget unavailable")
    ).rejects.toThrow("not saved");
  });
});

const gmailReceiveInput = {
  accessToken: "fixture",
  autoLabelEnabled: true,
  automationRuntime: {
    getAutoLabelContext: async () => ({
      availableLabelIds: new Set(["label"]),
      historyLabels: [],
      labels: [
        {
          autoLabel: null,
          description: null,
          id: "label",
          inclusionCriteria: null,
          name: "Follow up",
        },
      ],
      memoryCandidates: null,
      model: AUTO_LABEL_MODEL,
    }),
    getBudgetStatus: async () => ({ allowed: true, reason: "allowed" }),
  },
  extractCodes: false,
  gmailMessageId: "message",
  identity: { googleSubject: "fixture-subject", mailboxId: "gmail" },
  mailboxId: "gmail",
  organizationId: "team",
  userId: "owner",
} satisfies Parameters<typeof processGmailMessage>[0];

describe("Gmail receive AI authority", () => {
  beforeEach(() => {
    state.tables.clear();
    state.memoryUserId = null;
    state.shared = false;
    state.tables.set("mailboxAutomationSettings", [
      { autoLabelEnabled: true, mailboxId: "gmail" },
    ]);
    state.classify.mockReset().mockResolvedValue(["label"]);
    state.history.mockReset().mockResolvedValue(null);
    state.memoryContext.mockReset();
    state.tables.set("mailbox", [
      {
        googleSubject: "fixture-subject",
        id: "gmail",
        provider: "gmail",
        scopes: REQUIRED_GMAIL_SCOPES.join(" "),
        status: "connected",
      },
    ]);
    state.tables.set("gmailLabel", [
      { autoLabel: null, labelId: "label", mailboxId: "gmail" },
    ]);
    state.tables.set("gmailCredential", [
      {
        googleSubject: "fixture-subject",
        mailboxId: "gmail",
        scopes: REQUIRED_GMAIL_SCOPES.join(" "),
      },
    ]);
    state.gmailDispatched.length = 0;
    state.gmailMessage.mockReset().mockImplementation(async (_token, id) => ({
      from: "sender@example.test",
      id,
      internalDate: String(Date.now()),
      labelIds: ["INBOX"],
      threadId: "thread",
    }));
    state.gmailPrepare.mockReset().mockResolvedValue();
    state.gmailWrite
      .mockReset()
      .mockImplementation(
        async (_token, messageId, _change, _signal, beforeEffect) => {
          await state.gmailPrepare();
          await beforeEffect?.();
          state.gmailDispatched.push(messageId);
          return { id: messageId, isUnread: false, labelIds: ["label"] };
        }
      );
  });

  test("shared pause avoids classification and provider label changes", async () => {
    state.tables.set("mailboxAiAuthority", [
      {
        automationPaused: true,
        mailboxId: "gmail",
        readOnly: false,
        version: 1,
      },
    ]);
    await expect(processGmailMessage(gmailReceiveInput)).resolves.toMatchObject(
      {
        autoLabel: { reason: "policy", status: "skipped" },
      }
    );
    expect(state.classify).not.toHaveBeenCalled();
    expect(state.gmailDispatched).toHaveLength(0);
  });

  test("shared pause preserves matching deterministic rules in a mixed Gmail configuration", async () => {
    const autoLabel = {
      domains: [],
      enabled: true,
      keywordScope: "anywhere" as const,
      keywords: [],
      matchMode: "all" as const,
      prompt: "",
      senders: ["sender@example.test"],
    };
    state.tables
      .get("gmailLabel")
      ?.push({ autoLabel, labelId: "sender-rule", mailboxId: "gmail" });
    state.tables.set("mailboxAiAuthority", [
      {
        automationPaused: true,
        mailboxId: "gmail",
        readOnly: false,
        version: 1,
      },
    ]);
    await expect(
      processGmailMessage({
        ...gmailReceiveInput,
        automationRuntime: {
          ...gmailReceiveInput.automationRuntime,
          getAutoLabelContext: async () => {
            const context =
              await gmailReceiveInput.automationRuntime.getAutoLabelContext();
            return {
              ...context,
              availableLabelIds: new Set(["label", "sender-rule"]),
              labels: [
                ...context.labels,
                {
                  autoLabel,
                  description: null,
                  id: "sender-rule",
                  inclusionCriteria: null,
                  name: "Known sender",
                },
              ],
            };
          },
        },
      })
    ).resolves.toMatchObject({
      autoLabel: { reason: "policy", status: "skipped" },
    });
    const applied = state.gmailWrite.mock.calls.flatMap((call) =>
      typeof call[2] === "string" ? [] : (call[2].addLabelIds ?? [])
    );
    expect(applied).toContain("sender-rule");
    expect(applied).not.toContain("label");
    expect(state.classify).not.toHaveBeenCalled();
    expect(state.memoryContext).not.toHaveBeenCalled();
    expect(state.history).not.toHaveBeenCalled();
  });

  test("read-only applied during provider preparation prevents Gmail dispatch", async () => {
    state.gmailPrepare.mockImplementation(async () => {
      state.tables.set("mailboxAiAuthority", [
        {
          automationPaused: false,
          mailboxId: "gmail",
          readOnly: true,
          version: 1,
        },
      ]);
    });
    await expect(processGmailMessage(gmailReceiveInput)).resolves.toMatchObject(
      {
        autoLabel: { reason: "policy", status: "skipped" },
      }
    );
    expect(state.classify).toHaveBeenCalledOnce();
    expect(state.gmailDispatched).toHaveLength(0);
    expect(state.tables.get("gmailAutoLabelEvent")?.[0]?.appliedAt).toBeNull();
  });

  test("a label disabled during provider preparation cannot be applied from cached context", async () => {
    state.gmailPrepare.mockImplementation(async () => {
      const label = state.tables.get("gmailLabel")?.[0];
      if (label === undefined) {
        throw new Error("Expected the label fixture.");
      }
      label.autoLabel = { enabled: false };
    });
    await expect(processGmailMessage(gmailReceiveInput)).resolves.toMatchObject(
      { autoLabel: { reason: "policy", status: "skipped" } }
    );
    expect(state.gmailDispatched).toHaveLength(0);
    expect(state.tables.get("gmailAutoLabelEvent")?.[0]?.appliedAt).toBeNull();
  });

  test("pause during history loading prevents starting automatic semantic context", async () => {
    const enteredHistory = Promise.withResolvers<boolean>();
    const history =
      Promise.withResolvers<
        Awaited<ReturnType<typeof loadMailAutoLabelHistory>>
      >();
    state.history.mockImplementation(async () => {
      enteredHistory.resolve(true);
      return await history.promise;
    });
    const processing = processGmailMessage({
      ...gmailReceiveInput,
      automationRuntime: {
        ...gmailReceiveInput.automationRuntime,
        getAutoLabelContext: async () => {
          const context =
            await gmailReceiveInput.automationRuntime.getAutoLabelContext();
          return {
            ...context,
            memoryCandidates: { mailboxId: "gmail", userId: "owner" },
          };
        },
      },
    });
    await enteredHistory.promise;
    state.tables.set("mailboxAiAuthority", [
      {
        automationPaused: true,
        mailboxId: "gmail",
        readOnly: false,
        version: 1,
      },
    ]);
    history.resolve(null);
    await expect(processing).resolves.toMatchObject({
      autoLabel: { reason: "policy", status: "skipped" },
    });
    expect(state.memoryContext).not.toHaveBeenCalled();
    expect(state.classify).not.toHaveBeenCalled();
    expect(state.gmailDispatched).toHaveLength(0);
  });

  test("disconnect during classification prevents a write with the earlier token", async () => {
    state.classify.mockImplementation(async () => {
      const account = state.tables.get("mailbox")?.[0];
      if (account === undefined) {
        throw new Error("Expected the mailbox fixture.");
      }
      account.status = "disconnected";
      return ["label"];
    });
    await expect(processGmailMessage(gmailReceiveInput)).resolves.toMatchObject(
      { autoLabel: { reason: "policy", status: "skipped" } }
    );
    expect(state.gmailDispatched).toHaveLength(0);
    expect(state.tables.get("gmailAutoLabelEvent")?.[0]?.appliedAt).toBeNull();
  });

  test("account rebinding during classification cannot reuse the earlier token identity", async () => {
    state.classify.mockImplementation(async () => {
      const account = state.tables.get("gmailCredential")?.[0];
      if (account === undefined) {
        throw new Error("Expected the mailbox fixture.");
      }
      account.googleSubject = "replacement-subject";
      return ["label"];
    });
    await expect(processGmailMessage(gmailReceiveInput)).resolves.toMatchObject(
      { autoLabel: { reason: "policy", status: "skipped" } }
    );
    expect(state.gmailDispatched).toHaveLength(0);
    expect(state.tables.get("gmailAutoLabelEvent")?.[0]?.appliedAt).toBeNull();
  });

  test("an allowed classification reaches the existing Gmail mutation", async () => {
    await expect(processGmailMessage(gmailReceiveInput)).resolves.toMatchObject(
      {
        autoLabel: { status: "complete" },
      }
    );
    expect(state.gmailDispatched).toContain("message");
  });
});
