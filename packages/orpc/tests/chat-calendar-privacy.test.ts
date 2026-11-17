import { isDeepStrictEqual } from "node:util";

import { foregroundComposeDraftSchema } from "@quieter/ai/chat-tools";
import type { createMailboxAiBillingContext } from "@quieter/billing/ai-reservation";
import type { ChatMessagePart } from "@quieter/database/schema";
import type { reportError } from "@quieter/observability";
import { simulateReadableStream, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";

import type { assertCanUseAi } from "../src/ai-access";
import type { getMailboxMemoryActor } from "../src/ai-memory-capture";
import { createAiChatResponse } from "../src/chat/service";
import type { assertAgentMailboxAccess } from "../src/mail-agent/access";
import type { assertAccessibleMailbox } from "../src/mailbox/service";

const fixture = vi.hoisted(() => ({
  availability: vi.fn<() => Promise<unknown>>(),
  model: vi.fn<() => MockLanguageModelV4>(),
  query:
    vi.fn<
      (query: string, parameters: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
  store: vi.fn<
    (raw: Uint8Array) => Promise<{
      bucket: string;
      key: string;
      provider: "r2";
    }>
  >(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Keep real Drizzle queries and replace only database transport, as in chat-isolation.test.ts.
vi.mock("@quieter/database/client", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const database = drizzle(fixture.query);
  Object.defineProperty(database, "transaction", {
    value: async <T>(run: (transaction: typeof database) => Promise<T>) =>
      await run(database),
  });
  return { db: database };
});
vi.mock(import("@quieter/ai/openrouter"), () => ({
  createChatModel: fixture.model,
}));
vi.mock(import("@quieter/billing/ai-reservation"), () => ({
  createMailboxAiBillingContext: vi.fn<typeof createMailboxAiBillingContext>(),
}));
vi.mock(import("../src/ai-access"), () => ({
  assertCanUseAi: vi.fn<typeof assertCanUseAi>(),
}));
vi.mock(import("../src/mail-agent/access"), () => ({
  assertAgentMailboxAccess: vi
    .fn<typeof assertAgentMailboxAccess>()
    .mockResolvedValue({
      canSaveDraft: true,
      memberId: "member",
      organizationId: "organization",
      provider: "managed",
      shared: true,
    }),
}));
vi.mock(import("../src/mailbox/service"), async () => {
  const { getMailboxCapabilities } = await import("@quieter/mail/data-plane");
  return {
    assertAccessibleMailbox: vi
      .fn<typeof assertAccessibleMailbox>()
      .mockResolvedValue({
        capabilities: getMailboxCapabilities({
          provider: "managed",
          role: "manager",
        }),
        contentRevision: 0,
        id: "mailbox",
        organizationId: "organization",
        provider: "managed",
      }),
  };
});
vi.mock(import("../src/ai-memory-capture"), () => ({
  getMailboxMemoryActor: vi
    .fn<typeof getMailboxMemoryActor>()
    .mockResolvedValue(null),
}));
vi.mock(import("../src/managed-mail/messages/raw-object-lifecycle"), () => ({
  storeRawMailObject: fixture.store,
}));
vi.mock(import("@quieter/observability"), () => ({
  reportError: vi.fn<typeof reportError>(),
}));
vi.mock(import("@quieter/ai/chat-agent"), async (original) => ({
  ...(await original()),
  createCalendarChatTools: () => ({
    list_calendar_availability: tool({
      execute: fixture.availability,
      inputSchema: z.strictObject({ calendarIds: z.array(z.string()).min(1) }),
    }),
  }),
}));

const threadId = "b44942c1-aeeb-40a9-9da8-5c054e9f6030";
const foreground = {
  capabilities: ["compose", "navigate"],
  exchangeId: "d6c6b64a-1d5f-4406-9b1b-53a73ff6f41b",
  expiresAt: Date.now() + 60_000,
  generation: 1,
  tabId: "tab-1",
};
const draft = foregroundComposeDraftSchema.parse({
  attachments: [],
  bcc: "",
  bodyHtml: "<p>A proposed meeting time.</p>",
  bodyText: "A proposed meeting time.",
  cc: "",
  draftId: "visible-draft",
  draftRevision: 1,
  inlineImages: [],
  subject: "Meeting",
  to: "recipient@example.test",
});
const pendingWorkspace = {
  foreground,
  input: {},
  state: "input-available",
  toolCallId: "workspace",
  type: "tool-get_workspace",
};
const partsSchema = z.array(z.looseObject({ type: z.string() }));
type ModelStreamPart =
  Awaited<
    ReturnType<MockLanguageModelV4["doStream"]>
  >["stream"] extends ReadableStream<infer Part>
    ? Part
    : never;
const modelStep = (...parts: ModelStreamPart[]) => ({
  stream: simulateReadableStream({ chunks: parts }),
});
const finish = (reason: "stop" | "tool-calls"): ModelStreamPart => ({
  finishReason: { raw: undefined, unified: reason },
  type: "finish",
  usage: {
    inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
    outputTokens: { reasoning: 0, text: 1, total: 1 },
  },
});
let assistantParts: ChatMessagePart[];
let privateInbox = false;
let draftWrites = 0;
let heldAdmissions = 0;
let blockPrivateMarker: (() => Promise<void>) | undefined;

const runExchange = async () => {
  const response = await createAiChatResponse({
    body: {
      category: "inbox",
      foreground,
      mailboxId: "mailbox",
      message: {
        id: foreground.exchangeId,
        parts: [
          {
            ...pendingWorkspace,
            output: {
              draft,
              generation: 1,
              mailboxId: "mailbox",
              view: "compose",
            },
            state: "output-available",
          },
        ],
        role: "assistant",
      },
      threadId,
      trigger: "submit-message",
    },
    request: new Request("https://example.test/api/chat"),
    userId: "owner",
  });
  return await response.text();
};

const planModel = (toolName: string, input: unknown) => {
  const model = new MockLanguageModelV4({
    doStream: [
      modelStep(
        {
          input: JSON.stringify({ calendarIds: ["explicit-private-calendar"] }),
          toolCallId: "availability",
          toolName: "list_calendar_availability",
          type: "tool-call",
        },
        finish("tool-calls")
      ),
      modelStep(
        {
          input: JSON.stringify({ query: "" }),
          toolCallId: "search",
          toolName: "search_mail",
          type: "tool-call",
        },
        finish("tool-calls")
      ),
      modelStep(
        {
          input: JSON.stringify(input),
          toolCallId: "follow-up",
          toolName,
          type: "tool-call",
        },
        finish("tool-calls")
      ),
      modelStep(
        { id: "text", type: "text-start" },
        { delta: "Done.", id: "text", type: "text-delta" },
        { id: "text", type: "text-end" },
        finish("stop")
      ),
    ],
  });
  fixture.model.mockReturnValue(model);
  return model;
};

describe("calendar availability privacy through the foreground mail flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    privateInbox = false;
    draftWrites = 0;
    heldAdmissions = 0;
    blockPrivateMarker = undefined;
    assistantParts = [
      { foreground, type: "data-foreground" },
      {
        origin: {
          kind: "ai",
          mailboxId: "mailbox",
          mode: "interactive",
          policyVersion: 0,
          userId: "owner",
        },
        type: "data-ai-authority",
      },
      { type: "data-ai-private-context", used: false },
      pendingWorkspace,
    ];
    fixture.availability.mockResolvedValue({
      busy: [{ end: "2026-11-17T10:00:00Z", start: "2026-11-17T09:00:00Z" }],
      status: "success",
    });
    fixture.store.mockImplementation(async (raw) => {
      await Promise.resolve();
      if (new TextDecoder().decode(raw).startsWith("{")) {
        heldAdmissions += 1;
        throw new Error(
          "Controlled storage failure after held-send admission."
        );
      }
      return { bucket: "test-bucket", key: "test-draft", provider: "r2" };
    });
    fixture.query.mockImplementation(async (query, parameters) => {
      await Promise.resolve();
      if (query.startsWith('update "chatMessage"')) {
        const next = partsSchema.parse(parameters[0]);
        const expected = parameters.at(-1);
        if (!isDeepStrictEqual(expected, assistantParts)) {
          return { rows: [] };
        }
        if (
          next.some(
            (part) =>
              part.type === "data-ai-private-context" && part.used === true
          )
        ) {
          await blockPrivateMarker?.();
        }
        assistantParts = next;
        return { rows: [[foreground.exchangeId]] };
      }
      if (query.includes('from "chatMessage"')) {
        if (query.includes('"createdAt"')) {
          return {
            rows: [
              [
                "2026-11-16T00:00:00Z",
                foreground.exchangeId,
                assistantParts,
                1,
                "assistant",
              ],
              [
                "2026-11-16T00:00:00Z",
                "user-message",
                [
                  { foreground, type: "data-foreground" },
                  {
                    text: "Read availability and use the visible draft.",
                    type: "text",
                  },
                ],
                0,
                "user",
              ],
            ],
          };
        }
        return {
          rows: [
            [
              query.includes('"role" =')
                ? [{ foreground, type: "data-foreground" }]
                : assistantParts,
            ],
          ],
        };
      }
      if (query.includes('from "chat"')) {
        return {
          rows: [[threadId, "mailbox", "Existing conversation", "owner"]],
        };
      }
      if (query.includes('from "mailboxAiAuthority"')) {
        return { rows: [[false, false, 0]] };
      }
      if (query.includes('from "mailboxGrant"')) {
        return {
          rows:
            query.includes("inner join") && !query.includes(" <> ")
              ? [
                  [
                    0,
                    "Inbox",
                    "inbox@example.test",
                    "mailbox",
                    "organization",
                    privateInbox ? "owner" : null,
                    "managed",
                    "manager",
                  ],
                ]
              : [],
        };
      }
      if (query.includes('from "mailboxDivisionGrant"')) {
        return { rows: [] };
      }
      if (query.includes('from "mailbox"')) {
        if (query.includes('"accessMode"')) {
          return {
            rows: [
              [
                privateInbox ? "private" : "shared",
                privateInbox ? "owner" : null,
                null,
                "managed",
              ],
            ],
          };
        }
        return {
          rows: [
            query.includes('"provider"')
              ? ["managed", "connected"]
              : ["mailbox"],
          ],
        };
      }
      if (query.startsWith('insert into "managedMailMessage"')) {
        draftWrites += 1;
        return { rows: [] };
      }
      if (
        query.startsWith('update "gmailComposeOperation"') &&
        query.includes("returning")
      ) {
        return { rows: [["compose-lock"]] };
      }
      if (
        query.startsWith("insert ") ||
        query.startsWith("update ") ||
        query.startsWith("delete ")
      ) {
        return { rows: [] };
      }
      if (
        /from "(?:managedMailMessage|organizationMailSendIdempotency|scheduledMailSend|scheduledMailSendAbandonment|gmailComposeOperation)"/u.test(
          query
        )
      ) {
        return { rows: [] };
      }
      throw new Error(`Unexpected database transport query: ${query}`);
    });
  });

  test.each(["save_compose_draft", "send_mail"])(
    "private availability blocks shared %s after durable classification",
    async (toolName) => {
      planModel(toolName, { draft });
      expect(assistantParts).toContainEqual(
        expect.objectContaining({
          type: "data-ai-private-context",
          used: false,
        })
      );
      await runExchange();
      expect(draftWrites).toBe(0);
      expect(heldAdmissions).toBe(0);
      expect(assistantParts).toContainEqual(
        expect.objectContaining({
          state: "output-available",
          toolCallId: "search",
        })
      );
      expect(assistantParts).toContainEqual(
        expect.objectContaining({ type: "data-ai-private-context", used: true })
      );
      expect(assistantParts).toContainEqual(
        expect.objectContaining({
          state: "output-available",
          toolCallId: "availability",
        })
      );
      const failed = assistantParts.find(
        (part) => part.toolCallId === "follow-up"
      );
      expect(failed?.state).toBe("output-error");
      expect(failed?.errorText).toMatch(/personal context.*shared inbox/iu);
    }
  );

  test("does not release availability output before the private marker CAS completes", async () => {
    const attempted = Promise.withResolvers<boolean>();
    const release = Promise.withResolvers<boolean>();
    blockPrivateMarker = async () => {
      attempted.resolve(true);
      await release.promise;
    };
    const model = planModel("save_compose_draft", { draft });
    const exchange = (async () => {
      await runExchange();
      return false;
    })();
    try {
      await expect(
        Promise.race([attempted.promise, exchange])
      ).resolves.toBeTruthy();
      expect(assistantParts).toContainEqual(
        expect.objectContaining({
          type: "data-ai-private-context",
          used: false,
        })
      );
      expect(
        assistantParts.some((part) => part.toolCallId === "availability")
      ).toBeFalsy();
      expect(model.doStreamCalls).toHaveLength(1);
    } finally {
      release.resolve(true);
      await exchange;
    }
    expect(assistantParts).toContainEqual(
      expect.objectContaining({ type: "data-ai-private-context", used: true })
    );
    expect(draftWrites).toBe(0);
  });

  test("allows mail search and unsaved composition after private availability", async () => {
    planModel("open_compose", {
      bodyText: "A proposed meeting time.",
      subject: "Meeting",
      to: "recipient@example.test",
    });
    await runExchange();
    expect(assistantParts).toContainEqual(
      expect.objectContaining({
        state: "output-available",
        toolCallId: "search",
      })
    );
    expect(assistantParts).toContainEqual(
      expect.objectContaining({
        state: "input-available",
        toolCallId: "follow-up",
      })
    );
    expect(assistantParts).toContainEqual(
      expect.objectContaining({ type: "data-ai-private-context", used: true })
    );
    expect(draftWrites).toBe(0);
    expect(heldAdmissions).toBe(0);
  });

  test("keeps private-inbox draft persistence available after a private read", async () => {
    privateInbox = true;
    planModel("save_compose_draft", { draft });
    await runExchange();
    expect(draftWrites).toBe(1);
    expect(assistantParts).toContainEqual(
      expect.objectContaining({
        state: "output-available",
        toolCallId: "follow-up",
      })
    );
  });

  test("an unsuccessful availability read leaves a public shared draft writable", async () => {
    fixture.availability.mockResolvedValue({ status: "error" });
    planModel("save_compose_draft", { draft });
    await runExchange();
    expect(draftWrites).toBe(1);
    expect(assistantParts).toContainEqual(
      expect.objectContaining({ type: "data-ai-private-context", used: false })
    );
  });
});
