import {
  foregroundComposeDraftSchema,
  foregroundSnapshotSchema,
} from "@quieter/ai/chat-tools";
import { describe, expect, test } from "vite-plus/test";

import {
  cancelForegroundExchangeParts,
  cancelPendingChatParts,
  interruptedChatParts,
  normalizeExpiredChatParts,
} from "../src/chat/continuation";
import {
  resolveForegroundComposeDraftForPersistence,
  toForegroundComposeMessage,
  validateChatRequest,
} from "../src/chat/service";

const foreground = foregroundSnapshotSchema.parse({
  capabilities: ["navigate"],
  exchangeId: "d6c6b64a-1d5f-4406-9b1b-53a73ff6f41b",
  expiresAt: Date.now() + 60_000,
  generation: 1,
  tabId: "tab-1",
});

describe("interrupted chat history", () => {
  test("keeps confirmed writes and closes pending actions after a timeout", () => {
    const result = interruptedChatParts({
      errorText: "Timed out while finishing the reply.",
      persistedParts: [
        { foreground, type: "data-foreground" },
        {
          output: { status: "success" },
          state: "output-available",
          toolCallId: "applied",
          type: "tool-modify_mail",
        },
        {
          foreground,
          state: "input-available",
          toolCallId: "pending",
          type: "tool-navigate",
        },
      ],
      retryable: true,
      streamedParts: [
        { text: "I moved the first message.", type: "text" },
        {
          output: { status: "error" },
          toolCallId: "applied",
          type: "tool-modify_mail",
        },
        { text: "Opening the workspace next.", type: "text" },
      ],
    });
    expect(result).toContainEqual(
      expect.objectContaining({
        output: { status: "success" },
        state: "output-available",
        toolCallId: "applied",
      })
    );
    expect(result).toContainEqual(
      expect.objectContaining({ state: "output-error", toolCallId: "pending" })
    );
    expect(
      result.find((part) => part.type === "data-chat-interruption")?.data
    ).toMatch(/timed out/iu);
    expect(result.slice(0, 3)).toMatchObject([
      { text: "I moved the first message.", type: "text" },
      { state: "output-available", toolCallId: "applied" },
      { text: "Opening the workspace next.", type: "text" },
    ]);
    expect(result).not.toContainEqual(
      expect.objectContaining({ type: "data-foreground-failed" })
    );
  });

  test("retains streamed reads and cancels pending actions missing from persistence", () => {
    const result = interruptedChatParts({
      errorText: "Interrupted.",
      persistedParts: [{ foreground, type: "data-foreground" }],
      retryable: true,
      streamedParts: [
        { text: "Found one message.", type: "text" },
        {
          input: {},
          output: { ids: ["mail-1"] },
          state: "output-available",
          toolCallId: "search",
          type: "tool-search_gmail",
        },
        {
          input: {},
          state: "input-available",
          toolCallId: "navigate",
          type: "tool-navigate",
        },
      ],
    });
    expect(result).toMatchObject([
      { text: "Found one message.", type: "text" },
      { output: { ids: ["mail-1"] }, toolCallId: "search" },
      { state: "output-error", toolCallId: "navigate" },
      { type: "data-chat-interruption" },
    ]);
    expect(
      result.some((part) => part.type === "data-foreground-failed")
    ).toBeFalsy();
  });

  test("allows retry only when no answer or tool action was produced", () => {
    const result = interruptedChatParts({
      errorText: "Interrupted.",
      persistedParts: [{ foreground, type: "data-foreground" }],
      retryable: true,
      streamedParts: [
        { type: "step-start" },
        { text: "Thinking about the request", type: "reasoning" },
      ],
    });
    expect(
      result.some((part) => part.type === "data-foreground-failed")
    ).toBeTruthy();
    expect(result.some((part) => part.type === "text")).toBeFalsy();
  });

  test("keeps a confirmed write even when the stream failed before delivering it", () => {
    const result = interruptedChatParts({
      errorText: "Interrupted.",
      persistedParts: [
        {
          input: {},
          output: { status: "sent" },
          state: "output-available",
          toolCallId: "sent",
          type: "tool-send_mail",
        },
      ],
      retryable: true,
      streamedParts: [{ text: "Sending your message.", type: "text" }],
    });
    expect(result).toContainEqual(
      expect.objectContaining({
        output: { status: "sent" },
        state: "output-available",
        toolCallId: "sent",
      })
    );
    expect(
      result.some((part) => part.type === "data-foreground-failed")
    ).toBeFalsy();
  });

  test("does not make a canceled empty turn retryable", () => {
    const result = interruptedChatParts({
      errorText: "Interrupted.",
      persistedParts: [{ type: "data-foreground-cancelled" }],
      retryable: true,
      streamedParts: [{ type: "step-start" }],
    });
    expect(result).toContainEqual({ type: "data-foreground-cancelled" });
    expect(
      result.some((part) => part.type === "data-foreground-failed")
    ).toBeFalsy();
  });
});

const richDraft = foregroundComposeDraftSchema.parse({
  attachments: [],
  bcc: "",
  bodyHtml: '<p>Hello <strong>Sam</strong></p><img src="cid:chart-1">',
  bodyText: "Hello Sam",
  cc: "",
  draftId: "draft-1",
  draftRevision: 4,
  inlineImages: [],
  subject: "Project update",
  to: "sam@example.test",
});

const transcriptWithDraft = (draft: typeof richDraft) => [
  {
    id: foreground.exchangeId,
    parts: [
      {
        input: {},
        output: {
          draft,
          generation: foreground.generation,
          mailboxId: "mailbox-1",
          view: "compose",
        },
        state: "output-available" as const,
        toolCallId: "workspace-1",
        type: "tool-get_workspace" as const,
      },
    ],
    role: "assistant" as const,
  },
];

describe("foreground chat requests", () => {
  test("does not save a retained draft after the visible workspace moved to Calendar", () => {
    const transcript = transcriptWithDraft(richDraft);
    const [message] = transcript;
    expect(() => {
      resolveForegroundComposeDraftForPersistence({
        draft: richDraft,
        foreground,
        mailboxId: "mailbox-1",
        transcript: [
          {
            ...message,
            id: foreground.exchangeId,
            parts: [
              ...(message?.parts ?? []),
              {
                input: { date: "2026-10-23" },
                output: {
                  calendar: {
                    date: "2026-10-23",
                    timeZone: "Europe/Berlin",
                    view: "week",
                    visibleCalendars: [],
                  },
                  generation: foreground.generation,
                  mailboxId: "mailbox-1",
                  view: "calendar",
                  workspace: "calendar",
                },
                state: "output-available",
                toolCallId: "calendar-nav",
                type: "tool-navigate_calendar",
              },
            ],
            role: "assistant",
          },
        ],
      });
    }).toThrow(/open mail/iu);
  });

  test("binds persistence to the latest visible draft", () => {
    expect(
      resolveForegroundComposeDraftForPersistence({
        draft: richDraft,
        foreground,
        mailboxId: "mailbox-1",
        transcript: transcriptWithDraft(richDraft),
      })
    ).toStrictEqual(richDraft);

    expect(() =>
      resolveForegroundComposeDraftForPersistence({
        draft: { ...richDraft, bodyHtml: "<p>Changed by the model</p>" },
        foreground,
        mailboxId: "mailbox-1",
        transcript: transcriptWithDraft(richDraft),
      })
    ).toThrow(/visible draft changed/u);
  });

  test("persists the reviewed sender name and rejects changes or omission", () => {
    const draft = { ...richDraft, senderName: "Customer Support" };
    const reviewedDraft = resolveForegroundComposeDraftForPersistence({
      draft,
      foreground,
      mailboxId: "mailbox-1",
      transcript: transcriptWithDraft(draft),
    });

    expect(
      toForegroundComposeMessage(reviewedDraft, "chat-local-id")
    ).toMatchObject({ senderName: draft.senderName });

    for (const proposed of [richDraft, { ...draft, senderName: "Sales" }]) {
      expect(() =>
        resolveForegroundComposeDraftForPersistence({
          draft: proposed,
          foreground,
          mailboxId: "mailbox-1",
          transcript: transcriptWithDraft(draft),
        })
      ).toThrow(/visible draft changed/u);
    }
  });

  test("does not fall back to an older workspace after a newer mismatched read", () => {
    const transcript = transcriptWithDraft(richDraft);
    transcript[0]?.parts.push({
      input: {},
      output: {
        draft: richDraft,
        generation: foreground.generation + 1,
        mailboxId: "mailbox-1",
        view: "compose",
      },
      state: "output-available",
      toolCallId: "workspace-2",
      type: "tool-get_workspace",
    });

    expect(() =>
      resolveForegroundComposeDraftForPersistence({
        draft: richDraft,
        foreground,
        mailboxId: "mailbox-1",
        transcript,
      })
    ).toThrow(/Read the visible draft again/u);
  });

  test("refuses to drop attachment content at the JSON persistence boundary", () => {
    const attachedDraft = {
      ...richDraft,
      attachments: [
        {
          id: "attachment-1",
          isInline: false as const,
          mimeType: "application/pdf",
          name: "brief.pdf",
          size: 2048,
        },
      ],
    };

    expect(() =>
      resolveForegroundComposeDraftForPersistence({
        draft: attachedDraft,
        foreground,
        mailboxId: "mailbox-1",
        transcript: transcriptWithDraft(attachedDraft),
      })
    ).toThrow(/from the composer/u);

    expect(() =>
      resolveForegroundComposeDraftForPersistence({
        draft: richDraft,
        foreground,
        mailboxId: "mailbox-1",
        transcript: transcriptWithDraft(attachedDraft),
      })
    ).toThrow(/visible draft changed/u);
  });

  test("rejects a client result from an older generation", () => {
    expect(() =>
      validateChatRequest({
        category: "inbox",
        foreground,
        mailboxId: "mailbox-1",
        message: {
          id: "assistant-1",
          parts: [
            {
              output: { generation: 2, mailboxId: "mailbox-1" },
              state: "output-available",
              toolCallId: "tool-1",
              type: "tool-get_workspace",
            },
          ],
          role: "assistant",
        },
        model: "openai/gpt-5.6-luna",
        threadId: "7c8392e0-867f-4e53-a09c-b284a8af30e2",
        trigger: "submit-message",
      })
    ).toThrow(/older workspace state/u);
  });

  test("terminalizes every pending tool without touching completed receipts", () => {
    expect(
      cancelPendingChatParts([
        {
          approval: { id: "approval-1" },
          state: "approval-requested",
          toolCallId: "server-1",
          type: "tool-send_mail",
        },
        {
          input: {},
          state: "input-available",
          toolCallId: "client-1",
          type: "tool-navigate",
        },
        {
          output: { status: "sent" },
          state: "output-available",
          toolCallId: "done-1",
          type: "tool-send_mail",
        },
      ])
    ).toMatchObject([
      { state: "output-error", toolCallId: "server-1" },
      { state: "output-error", toolCallId: "client-1" },
      { state: "output-available", toolCallId: "done-1" },
    ]);
  });

  test("terminalizes pending work with missing or malformed foreground leases", () => {
    const missing = [
      {
        input: {},
        state: "input-available",
        toolCallId: "tool-1",
        type: "tool-navigate",
      },
    ];
    const malformed = [
      {
        approval: { id: "approval-1" },
        foreground: { expiresAt: 200 },
        input: {},
        state: "approval-requested",
        toolCallId: "tool-2",
        type: "tool-navigate",
      },
    ];

    expect(normalizeExpiredChatParts(missing, 100)).toContainEqual(
      expect.objectContaining({ state: "output-error", toolCallId: "tool-1" })
    );
    expect(normalizeExpiredChatParts(malformed, 100)).toContainEqual(
      expect.objectContaining({ state: "output-error", toolCallId: "tool-2" })
    );
  });

  test("preserves pending work with a valid unexpired foreground lease", () => {
    const pending = [
      {
        foreground: { ...foreground, expiresAt: 200 },
        input: {},
        state: "input-available",
        toolCallId: "tool-1",
        type: "tool-navigate",
      },
    ];

    expect(normalizeExpiredChatParts(pending, 100)).toMatchObject([
      { state: "input-available", toolCallId: "tool-1" },
    ]);
  });

  test("terminalizes pending work with an expired foreground lease", () => {
    const pending = [
      {
        foreground: { ...foreground, expiresAt: 100 },
        input: {},
        state: "input-available",
        toolCallId: "tool-1",
        type: "tool-navigate",
      },
    ];

    expect(normalizeExpiredChatParts(pending, 100)).toContainEqual(
      expect.objectContaining({ state: "output-error", toolCallId: "tool-1" })
    );
  });

  test("preserves completed work without requiring a foreground lease", () => {
    const completed = [
      {
        output: { status: "sent" },
        state: "output-available",
        toolCallId: "tool-1",
        type: "tool-send_mail",
      },
    ];

    expect(normalizeExpiredChatParts(completed, 100)).toMatchObject([
      { output: { status: "sent" }, state: "output-available" },
    ]);
  });

  test("records cancellation after approval has already been claimed", () => {
    expect(
      cancelForegroundExchangeParts([
        {
          approval: { approved: true, id: "approval-1" },
          foreground: { exchangeId: foreground.exchangeId },
          state: "approval-responded",
          toolCallId: "tool-1",
          type: "tool-send_mail",
        },
      ])
    ).toMatchObject([
      { state: "approval-responded", toolCallId: "tool-1" },
      { type: "data-foreground-cancelled" },
    ]);
  });
});
