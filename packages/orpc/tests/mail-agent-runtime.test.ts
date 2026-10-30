/* oxlint-disable eslint/require-await -- Persistence and provider doubles keep asynchronous contracts without network I/O. */
import { ORPCError } from "@orpc/server";
import { actionSpecificationSchema } from "@quieter/ai/action-specification";
import type { createMailboxAiBillingContext } from "@quieter/billing/ai-reservation";
import { MockLanguageModelV4 } from "ai/test";
import type * as Drizzle from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { recordAiGeneratedMailBody } from "../src/ai-mail-authorship";
import type { loadAiAgentContext } from "../src/ai-memory";
import type {
  listLinearMcpToolsForUser,
  runLinearMcpToolCallsForUser,
} from "../src/connectors/linear-mcp";
import {
  compileAgentManifest,
  loadAgentCatalog,
} from "../src/mail-agent/catalog";
import { drainMailAgentRuns } from "../src/mail-agent/runtime";
import type { composeMailOperations } from "../src/mail/compose";

type Row = Record<string, unknown>;
type Predicate = (row: Row) => boolean;
const state = vi.hoisted(() => ({
  authorized: true,
  linear: vi.fn<typeof runLinearMcpToolCallsForUser>(),
  linearTools: vi.fn<typeof listLinearMcpToolsForUser>(),
  memory: vi.fn<typeof loadAiAgentContext>(),
  model: vi.fn<() => MockLanguageModelV4>(),
  provenance: vi.fn<typeof recordAiGeneratedMailBody>(),
  read: vi.fn<() => Promise<unknown>>(),
  save: vi.fn<
    (
      input: Parameters<typeof composeMailOperations.saveDraft>[0]
    ) => Promise<
      Pick<
        Awaited<ReturnType<typeof composeMailOperations.saveDraft>>,
        "baseRevision" | "draftId" | "messageId"
      >
    >
  >(),
  shared: false,
  tables: new Map<string, Row[]>(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Evaluate authorization and lease predicates against independent in-memory rows.
vi.mock("drizzle-orm", async (original) => ({
  ...(await original<typeof Drizzle>()),
  and:
    (...predicates: (Predicate | undefined)[]) =>
    (row: Row) =>
      predicates.every(
        (predicate) => typeof predicate !== "function" || predicate(row)
      ),
  eq: (column: { name: string }, value: unknown) => (row: Row) =>
    row[column.name] === value,
  gt: (column: { name: string }, value: Date) => (row: Row) => {
    const current = row[column.name];
    return current instanceof Date && current > value;
  },
  inArray: (column: { name: string }, values: unknown[]) => (row: Row) =>
    values.includes(row[column.name]),
  lt: (column: { name: string }, value: Date) => (row: Row) => {
    const current = row[column.name];
    return current instanceof Date && current < value;
  },
  or:
    (...predicates: Predicate[]) =>
    (row: Row) =>
      predicates.some((predicate) => predicate(row)),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Keep durable run/effect state observable while exercising the real runtime and AI SDK tool loop.
vi.mock("@quieter/database/client", async () => {
  const { getTableName } = await import("drizzle-orm");
  type Table = Parameters<typeof getTableName>[0];
  const build = (
    table: Table,
    operation: "insert" | "select" | "update",
    values?: Row
  ) => {
    let predicate: Predicate | undefined;
    let limit = Number.POSITIVE_INFINITY;
    const query = {
      for: () => query,
      limit: (next: number) => {
        limit = next;
        return query;
      },
      orderBy: () => query,
      returning: () => query,
      // oxlint-disable-next-line unicorn/no-thenable -- Drizzle executes a query when its builder is awaited.
      then: async (fulfilled: (rows: Row[]) => unknown) => {
        const name = getTableName(table);
        const rows = state.tables.get(name) ?? [];
        state.tables.set(name, rows);
        if (operation === "insert" && values !== undefined) {
          rows.push(values);
        }
        const selected = rows
          .filter((row) => predicate?.(row) ?? true)
          .slice(0, limit);
        if (operation === "update" && values !== undefined) {
          for (const row of selected) {
            Object.assign(row, values);
          }
        }
        return await fulfilled(selected);
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
    select: () => ({ from: (table: Table) => build(table, "select") }),
    update: (table: Table) => ({
      set: (values: Row) => build(table, "update", values),
    }),
  };
  return {
    db: {
      ...operations,
      transaction: async <Result>(
        run: (tx: typeof operations) => Promise<Result>
      ) => await run(operations),
    },
  };
});

vi.mock(import("@quieter/ai/openrouter"), async (original) => ({
  ...(await original()),
  createChatModel: state.model,
}));
vi.mock(import("../src/ai-mail-authorship"), () => ({
  recordAiGeneratedMailBody: state.provenance,
}));
vi.mock(import("../src/connectors/linear-mcp"), async (original) => ({
  ...(await original()),
  listLinearMcpToolsForUser: state.linearTools,
  runLinearMcpToolCallsForUser: state.linear,
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The actor grant can be revoked independently of the saved setting.
vi.mock("../src/mail-agent/access", () => ({
  assertAgentMailboxAccess: async () => {
    if (!state.authorized) {
      throw new ORPCError("FORBIDDEN", { message: "Access was revoked." });
    }
    return { organizationId: "organization", shared: state.shared };
  },
}));
vi.mock(import("../src/mail-automation/ai-budget"), async (original) => ({
  ...(await original()),
  getMailAutomationAiBudgetStatus: async () => ({
    allowed: true,
    reason: "allowed" as const,
  }),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Mail adapters are the external provider boundary for this test.
vi.mock("../src/mail/compose", () => ({
  composeMailOperations: { saveDraft: state.save },
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- No real mailbox or personal context leaves the test process.
vi.mock("../src/mail/queries", () => ({
  queriesMailOperations: { getThread: state.read },
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Actions uses selected context, while the module also exposes an unrelated overview overload.
vi.mock("../src/ai-memory", async () => {
  const { buildMailMemoryQuery, serializeAiAgentContext } =
    await import("../src/ai-memory-context");
  return {
    buildMailMemoryQuery,
    loadAiAgentContext: state.memory,
    serializeAiAgentContext,
  };
});
vi.mock(import("../src/mail-agent/usage"), () => ({
  reportAgentUsage: async () => {},
}));
vi.mock(import("../src/mail-updates"), async (original) => ({
  ...(await original()),
  publishMailUpdate: async () => {},
}));
vi.mock(import("@quieter/observability"), async (original) => ({
  ...(await original()),
  reportError: () => {},
}));

type Generation = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
const generation = (
  content: Generation["content"],
  tools = false
): Generation => ({
  content,
  finishReason: { raw: undefined, unified: tools ? "tool-calls" : "stop" },
  providerMetadata: { openrouter: { usage: { cost: 0.001 } } },
  usage: {
    inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 10, total: 10 },
    outputTokens: { reasoning: 0, text: 10, total: 10 },
  },
  warnings: [],
});

const modelWithDrafts = (bodies: string[]) =>
  new MockLanguageModelV4({
    doGenerate: [
      generation(
        bodies.map((bodyText, index) => ({
          input: JSON.stringify({
            bodyText,
            subject: "Reply",
            to: "sender@example.test",
          }),
          toolCallId: `call-${index}`,
          toolName: "capability_1",
          type: "tool-call",
        })),
        true
      ),
      generation([
        {
          text: JSON.stringify({
            matched: true,
            summary: "Prepared replies for review.",
          }),
          type: "text",
        },
      ]),
    ],
  });

const runRow = () => {
  const row = state.tables.get("mailboxAgentRun")?.[0];
  if (row === undefined) {
    throw new Error("Expected the fixture run.");
  }
  return row;
};

const grantPersonalContext = async () => {
  const revision = state.tables.get("mailboxAgentRevision")?.[0];
  if (revision === undefined) {
    throw new Error("Expected the reviewed fixture.");
  }
  const specification = actionSpecificationSchema.parse(revision.specification);
  specification.permissions.push({
    id: "personal-context",
    operation: "read",
    scope: "memory",
  });
  specification.toolGrants.push({
    confirmation: "none",
    permissionId: "personal-context",
    toolId: "memory.read",
  });
  const manifest = compileAgentManifest(
    specification,
    await loadAgentCatalog({ connectionIds: [], userId: "actor" })
  );
  Object.assign(revision, { manifestDigest: manifest.digest, specification });
};

const grantLinearWrites = async (toolNames: string[]) => {
  const revision = state.tables.get("mailboxAgentRevision")?.[0];
  if (revision === undefined) {
    throw new Error("Expected the reviewed fixture.");
  }
  const specification = actionSpecificationSchema.parse(revision.specification);
  specification.connectors.push({
    connectionId: "linear-account",
    referenceId: "tasks",
  });
  specification.sourceText += " Use @[connection:linear-account].";
  specification.permissions.push({
    connectorReferenceId: "tasks",
    id: "tasks-write",
    operation: "write",
    scope: "connector",
  });
  for (const name of toolNames) {
    specification.toolGrants.push({
      confirmation: "none",
      permissionId: "tasks-write",
      toolId: `linear.${name}`,
    });
  }
  state.tables.set("connectorCredential", [
    {
      id: "linear-account",
      provider: "linear",
      scopes: "read,write",
      status: "connected",
      userId: "actor",
    },
  ]);
  state.linearTools.mockResolvedValue(
    toolNames.map((name) => ({
      inputSchema: {
        additionalProperties: false,
        properties: { id: { type: "string" }, title: { type: "string" } },
        required: ["title"],
        type: "object",
      },
      name,
    }))
  );
  const manifest = compileAgentManifest(
    specification,
    await loadAgentCatalog({
      connectionIds: ["linear-account"],
      userId: "actor",
    })
  );
  Object.assign(revision, { manifestDigest: manifest.digest, specification });
};

const modelWithLinearRevisions = (creation: boolean) =>
  new MockLanguageModelV4({
    doGenerate: [
      generation(
        ["First title", "Revised title", "First title"].map((title, index) => ({
          input: JSON.stringify({
            ...(creation && index !== 1 ? {} : { id: "issue" }),
            title,
          }),
          toolCallId: `task-${index}`,
          toolName: index === 1 ? "capability_3" : "capability_2",
          type: "tool-call",
        })),
        true
      ),
      generation([
        {
          text: JSON.stringify({
            matched: true,
            summary: "Prepared the requested task.",
          }),
          type: "text",
        },
      ]),
    ],
  });

describe("durable background action execution", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    state.authorized = true;
    state.shared = false;
    state.memory.mockReset();
    state.memory.mockResolvedValue({ instructions: null, memory: null });
    state.provenance.mockReset();
    state.provenance.mockResolvedValue();
    state.tables.clear();
    const now = new Date();
    const specification = actionSpecificationSchema.parse({
      connectors: [],
      instructions: "Prepare requested replies for review.",
      mailboxId: "mailbox",
      permissions: [
        { id: "read", operation: "read", scope: "mailbox" },
        { id: "write", operation: "write", scope: "mailbox" },
      ],
      review: { assumptions: [], questions: [], summary: "Prepare replies." },
      sourceText: "Prepare replies.",
      toolGrants: [
        {
          confirmation: "none",
          permissionId: "read",
          toolId: "mail.read_thread",
        },
        {
          confirmation: "none",
          permissionId: "write",
          toolId: "mail.save_draft",
        },
      ],
      trigger: { kind: "mail_received" },
      version: 1,
    });
    const manifest = compileAgentManifest(
      specification,
      await loadAgentCatalog({ connectionIds: [], userId: "actor" })
    );
    state.tables.set("mailboxAgentRevision", [
      {
        createdByUserId: "actor",
        id: "revision",
        mailboxId: "mailbox",
        manifestDigest: manifest.digest,
        specification,
        usage: null,
      },
    ]);
    state.tables.set("mailboxAgentSetting", [
      {
        activatedByUserId: "actor",
        activationVersion: 1,
        activeRevisionId: "revision",
        enabled: true,
        mailboxId: "mailbox",
      },
    ]);
    state.tables.set("mailboxAgentRun", [
      {
        actorUserId: "actor",
        attempts: 0,
        createdAt: now,
        draftId: null,
        errorMessage: null,
        id: "run",
        invocationKey: "received:message",
        leaseExpiresAt: null,
        leaseToken: null,
        mailboxId: "mailbox",
        messageId: "message",
        revisionId: "revision",
        settingVersion: 1,
        status: "queued",
        summary: null,
        threadId: "thread",
        triggerKind: "mail_received",
        updatedAt: now,
        usage: null,
        usageReportedAt: null,
      },
    ]);
    state.read.mockResolvedValue({
      messages: [
        {
          bodyText: "Please prepare a response.",
          cc: "Collaborator <collaborator@example.test>",
          from: "sender@example.test",
          id: "message",
          replyTo: "Reply desk <replies@example.test>",
          threadId: "thread",
        },
      ],
      threadId: "thread",
    });
    state.save.mockResolvedValue({
      baseRevision: "revision-1",
      draftId: "draft",
      messageId: "draft-message",
    });
  });

  test("reuses a confirmed identical effect but allows distinct intended inputs", async () => {
    state.model.mockReturnValue(
      modelWithDrafts(["First response", "First response", "Second response"])
    );
    await drainMailAgentRuns({ limit: 1 });
    expect(state.save).toHaveBeenCalledTimes(2);
    expect(state.tables.get("mailboxAgentEffect")).toHaveLength(2);
    expect(runRow()).toMatchObject({ status: "succeeded" });
  });

  test("an uncertain first change prevents a second same-step change", async () => {
    state.model.mockReturnValue(
      modelWithDrafts(["First response", "Second response"])
    );
    state.save.mockRejectedValue(
      new Error("Connection lost after provider acceptance.")
    );
    await drainMailAgentRuns({ limit: 1 });
    expect(state.save).toHaveBeenCalledOnce();
    expect(state.tables.get("mailboxAgentEffect")).toMatchObject([
      { status: "uncertain" },
    ]);
    expect(runRow()).toMatchObject({ status: "needs_attention" });
  });

  test("stops draft persistence if generated-body provenance cannot be recorded", async () => {
    state.model.mockReturnValue(modelWithDrafts(["A generated reply."]));
    state.provenance.mockRejectedValue(new Error("Provenance unavailable."));
    await drainMailAgentRuns({ limit: 1 });
    expect(state.save).not.toHaveBeenCalled();
    expect(runRow()).toMatchObject({ status: "needs_attention" });
  });

  test("updates its prepared draft using the confirmed revision instead of creating it again", async () => {
    state.model.mockReturnValue(
      modelWithDrafts(["First response", "Revised response"])
    );
    let revision: string | undefined;
    let savedBody: string | undefined;
    state.save.mockImplementation(async ({ input }) => {
      if (
        revision !== undefined &&
        (input.draft.draftId !== "draft" ||
          input.draft.baseRevision !== revision)
      ) {
        throw new ORPCError("CONFLICT", {
          message: "This draft changed elsewhere.",
        });
      }
      savedBody = input.draft.bodyText;
      revision = crypto.randomUUID();
      return {
        baseRevision: revision,
        draftId: "draft",
        messageId: "draft-message",
      };
    });
    await drainMailAgentRuns({ limit: 1 });
    expect(savedBody).toBe("Revised response");
    expect(runRow()).toMatchObject({ draftId: "draft", status: "succeeded" });
  });

  test("restores requested draft content after an intervening revision", async () => {
    state.model.mockReturnValue(
      modelWithDrafts(["First reply", "Revised reply", "First reply"])
    );
    let body: string | undefined;
    state.save.mockImplementation(async ({ input }) => {
      body = input.draft.bodyText;
      return {
        baseRevision: crypto.randomUUID(),
        draftId: "draft",
        messageId: "draft-message",
      };
    });
    await drainMailAgentRuns({ limit: 1 });
    expect(body).toBe("First reply");
    expect(runRow()).toMatchObject({ status: "succeeded" });
  });

  test.each(["create_issue", "save_issue", "save_comment"])(
    "keeps one creation across an intervening connector change (%s)",
    async (toolName) => {
      await grantLinearWrites([toolName, "update_issue"]);
      let created = 0;
      state.linear.mockImplementation(async ({ calls }) =>
        calls.map((call) => {
          if (call.arguments?.id === undefined) {
            created += 1;
          }
          return {
            durationMs: 1,
            output: { id: "issue" },
            status: "success",
            toolName: call.toolName,
          };
        })
      );
      state.model.mockReturnValue(modelWithLinearRevisions(true));
      await drainMailAgentRuns({ limit: 1 });
      expect(created).toBe(1);
      expect(runRow()).toMatchObject({ status: "succeeded" });
    }
  );

  test.each(["update_issue", "save_issue", "save_comment"])(
    "restores a connector update after a different method changes it (%s)",
    async (toolName) => {
      await grantLinearWrites([toolName, "create_comment"]);
      let title: unknown;
      state.linear.mockImplementation(async ({ calls }) =>
        calls.map((call) => {
          title = call.arguments?.title;
          return {
            durationMs: 1,
            output: { id: "issue" },
            status: "success",
            toolName: call.toolName,
          };
        })
      );
      state.model.mockReturnValue(modelWithLinearRevisions(false));
      await drainMailAgentRuns({ limit: 1 });
      expect(title).toBe("First title");
      expect(runRow()).toMatchObject({ status: "succeeded" });
    }
  );

  test("retains the triggering sender, body and reply header when many newer messages exist", async () => {
    state.read.mockResolvedValue({
      messages: [
        {
          bodyText: "Please review the original proposal.",
          from: "original@example.test",
          id: "message",
          messageHeaderId: "<incoming@example.test>",
        },
        ...Array.from({ length: 20 }, (_, index) => ({
          bodyText: "A later conversation.",
          from: "later@example.test",
          id: `later-${index}`,
          messageHeaderId: `<later-${index}@example.test>`,
        })),
      ],
      threadId: "thread",
    });
    const model = modelWithDrafts(["Thanks for the proposal."]);
    state.model.mockReturnValue(model);
    await drainMailAgentRuns({ limit: 1 });
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(
      "original@example.test"
    );
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(
      "original proposal"
    );
    expect(
      state.save.mock.calls[0]?.[0].input.draft.replyContext?.messageHeaderId
    ).toBe("<incoming@example.test>");
  });

  test("revoked authority stops before loading mail or personal context", async () => {
    await grantPersonalContext();
    state.authorized = false;
    await drainMailAgentRuns({ limit: 1 });
    expect(state.read).not.toHaveBeenCalled();
    expect(state.memory).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
    expect(runRow()).toMatchObject({ status: "needs_attention" });
  });

  test("supplies current actor context using the incoming participants only with a reviewed grant", async () => {
    await grantPersonalContext();
    state.memory.mockResolvedValue({
      instructions: null,
      memory: "Use warm, concise replies with this sender.",
    });
    const model = modelWithDrafts(["Thanks, received!"]);
    state.model.mockReturnValue(model);
    await drainMailAgentRuns({ limit: 1 });
    expect(state.memory.mock.calls[0]?.[0]).toMatchObject({
      agent: "mail_action",
      mailboxId: "mailbox",
      userId: "actor",
    });
    expect(state.memory.mock.calls[0]?.[0].query).toContain(
      "sender@example.test"
    );
    expect(state.memory.mock.calls[0]?.[0].query).toContain(
      "collaborator@example.test"
    );
    expect(state.memory.mock.calls[0]?.[0].query).toContain(
      "replies@example.test"
    );
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(
      "warm, concise replies"
    );
    expect(runRow()).toMatchObject({ draftId: "draft", status: "succeeded" });
    expect(
      JSON.stringify(state.tables.get("mailboxAgentRevision"))
    ).not.toContain("warm, concise replies");
  });

  test("does not load or inject personal context without its reviewed permission", async () => {
    state.memory.mockResolvedValue({
      instructions: null,
      memory: "Private relationship detail.",
    });
    const model = modelWithDrafts(["Thanks, received!"]);
    state.model.mockReturnValue(model);
    await drainMailAgentRuns({ limit: 1 });
    expect(state.memory).not.toHaveBeenCalled();
    expect(JSON.stringify(model.doGenerateCalls)).not.toContain(
      "Private relationship detail"
    );
    expect(runRow()).toMatchObject({ status: "succeeded" });
  });

  test("refuses personal-context runs in an already shared inbox", async () => {
    await grantPersonalContext();
    state.shared = true;
    await drainMailAgentRuns({ limit: 1 });
    expect(state.memory).not.toHaveBeenCalled();
    expect(state.model).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
    expect(runRow()).toMatchObject({ status: "needs_attention" });
  });

  test("discards context if the inbox becomes shared while it loads", async () => {
    await grantPersonalContext();
    state.memory.mockImplementation(async () => {
      state.shared = true;
      return { instructions: null, memory: "Private context." };
    });
    await drainMailAgentRuns({ limit: 1 });
    expect(state.model).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
    expect(runRow()).toMatchObject({ status: "needs_attention" });
  });

  test("rechecks private context access after recording provenance and before saving the draft", async () => {
    await grantPersonalContext();
    state.memory.mockResolvedValue({
      instructions: null,
      memory: "Private context.",
    });
    state.provenance.mockImplementation(async () => {
      state.shared = true;
    });
    state.model.mockReturnValue(modelWithDrafts(["A private reply."]));
    await drainMailAgentRuns({ limit: 1 });
    expect(state.save).not.toHaveBeenCalled();
    expect(runRow()).toMatchObject({ status: "needs_attention" });
  });

  test.each([false, true])(
    "preserves private context across focused reads and stops a newly shared draft (initial context %s)",
    async (initialContext) => {
      await grantPersonalContext();
      state.memory.mockImplementation(async (input) => {
        const focused = "query" in input && input.query.includes("renewal");
        let memory: string | null = null;
        if (focused && !initialContext) {
          memory = "The sender manages the user's renewal.";
        } else if (!focused && initialContext) {
          memory = "Use the user's private renewal preferences.";
        }
        return { instructions: null, memory };
      });
      let receivedFocusedContext = false;
      let toolCalls = 0;
      state.model.mockReturnValue(
        new MockLanguageModelV4({
          doGenerate: async (options) => {
            toolCalls += 1;
            if (toolCalls === 1) {
              return generation(
                [
                  {
                    input: JSON.stringify({ query: "renewal" }),
                    toolCallId: "focused-context",
                    toolName: "capability_2",
                    type: "tool-call",
                  },
                ],
                true
              );
            }
            receivedFocusedContext = JSON.stringify(options.prompt).includes(
              initialContext
                ? "private renewal preferences"
                : "manages the user's renewal"
            );
            state.shared = true;
            return generation(
              [
                {
                  input: JSON.stringify({
                    bodyText: "A private renewal reply.",
                    subject: "Renewal",
                    to: "sender@example.test",
                  }),
                  toolCallId: "shared-draft",
                  toolName: "capability_1",
                  type: "tool-call",
                },
              ],
              true
            );
          },
        })
      );
      await drainMailAgentRuns({ limit: 1 });
      expect(receivedFocusedContext).toBeTruthy();
      expect(state.save).not.toHaveBeenCalled();
      expect(runRow()).toMatchObject({ status: "needs_attention" });
    }
  );

  test("bounds fresh context reads even when one model step requests many", async () => {
    await grantPersonalContext();
    const calls = Array.from({ length: 16 }, (_, index) => ({
      input: "{}",
      toolCallId: `context-${index}`,
      toolName: "capability_2",
      type: "tool-call" as const,
    }));
    state.model.mockReturnValue(
      new MockLanguageModelV4({
        doGenerate: [
          generation(calls, true),
          generation([
            {
              text: JSON.stringify({
                matched: true,
                summary: "Reviewed context.",
              }),
              type: "text",
            },
          ]),
        ],
      })
    );
    await drainMailAgentRuns({ limit: 1 });
    expect(state.memory.mock.calls.length).toBeGreaterThan(1);
    expect(state.memory.mock.calls.length).toBeLessThan(calls.length);
    expect(state.save).not.toHaveBeenCalled();
  });

  test("finishes with a summary when a model keeps requesting tools", async () => {
    state.model.mockReturnValue(
      new MockLanguageModelV4({
        doGenerate: async (options) =>
          options.toolChoice?.type === "none"
            ? generation([
                {
                  text: JSON.stringify({
                    matched: true,
                    summary: "The sender requested a response.",
                  }),
                  type: "text",
                },
              ])
            : generation(
                [
                  {
                    input: "{}",
                    toolCallId: crypto.randomUUID(),
                    toolName: "capability_0",
                    type: "tool-call",
                  },
                ],
                true
              ),
      })
    );
    await drainMailAgentRuns({ limit: 1 });
    expect(runRow()).toMatchObject({ status: "succeeded" });
    expect(runRow().summary).toContain("requested a response");
    expect(state.save).not.toHaveBeenCalled();
  });

  test.each(["pending", "completed"] as const)(
    "expired work with a %s effect requires review and never replays",
    async (status) => {
      Object.assign(runRow(), {
        attempts: 1,
        leaseExpiresAt: new Date(Date.now() - 1000),
        leaseToken: "expired",
        status: "running",
      });
      state.tables.set("mailboxAgentEffect", [
        {
          id: "effect",
          mailboxId: "mailbox",
          runId: "run",
          status,
          toolCallId: "call",
          toolId: "mailbox:mail.save_draft",
        },
      ]);
      await drainMailAgentRuns({ limit: 1 });
      expect(state.model).not.toHaveBeenCalled();
      expect(state.save).not.toHaveBeenCalled();
      expect(state.tables.get("mailboxAgentEffect")).toMatchObject([
        { status: status === "pending" ? "uncertain" : status },
      ]);
      expect(runRow()).toMatchObject({ status: "needs_attention" });
      expect(runRow().usageReportedAt).toBeInstanceOf(Date);
    }
  );
});

vi.mock(import("@quieter/billing/ai-reservation"), () => ({
  createMailboxAiBillingContext: vi
    .fn<typeof createMailboxAiBillingContext>()
    .mockResolvedValue({
      account: null,
      admittedAt: new Date(),
      groupId: "fixture",
      kind: "team",
      organizationId: "test-team",
      usageKind: "aiChat",
    }),
}));
