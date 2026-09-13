import {
  foregroundComposeDraftSchema,
  foregroundSnapshotSchema,
} from "@quieter/ai/chat-tools";
import { describe, expect, test } from "vite-plus/test";

import {
  cancelForegroundExchangeParts,
  cancelPendingChatParts,
  normalizeExpiredChatParts,
} from "../src/chat/continuation";
import {
  ChatRequestError,
  resolveChatStreamErrorMessage,
  resolveForegroundComposeDraftForPersistence,
  toForegroundComposeMessage,
  validateChatRequest,
} from "../src/chat/service";

const foreground = foregroundSnapshotSchema.parse({
  capabilities: ["navigate"],
  exchangeId: "d6c6b64a-1d5f-4406-9b1b-53a73ff6f41b",
  expiresAt: Date.now() + 60_000,
  generation: 1,
  policy: "ask" as const,
  tabId: "tab-1",
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
  test("preserves reviewed rich HTML in the mail compose contract", () => {
    expect(
      toForegroundComposeMessage(richDraft, "chat-local-id")
    ).toMatchObject({
      attachments: [],
      bodyHtml: richDraft.bodyHtml,
      bodyText: richDraft.bodyText,
      inlineImages: [],
    });
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

  test("refuses to drop attachment content at the JSON approval boundary", () => {
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

    expect(normalizeExpiredChatParts(pending, 100)).toBe(pending);
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

    expect(normalizeExpiredChatParts(completed, 100)).toBe(completed);
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

describe("chat stream error messages", () => {
  test("maps a stale exchange conflict onto the retry text", () => {
    expect(
      resolveChatStreamErrorMessage(
        new ChatRequestError(409, "This chat changed.")
      )
    ).toBe("This chat changed while the answer was being completed. Retry it.");
  });

  test("maps a client disconnect onto the stopped text", () => {
    const aborted = new Error("The operation was aborted.");
    aborted.name = "AbortError";
    expect(resolveChatStreamErrorMessage(aborted)).toBe(
      "The request was stopped."
    );
  });

  test("maps provider throttling onto the busy text", () => {
    const throttled = Object.assign(new Error("Rate limited upstream."), {
      isRetryable: true,
      statusCode: 429,
    });
    throttled.name = "AI_APICallError";
    expect(resolveChatStreamErrorMessage(throttled)).toBe(
      "The assistant is busy. Retry shortly."
    );
  });

  test("keeps the generic text for unknown generation failures", () => {
    expect(resolveChatStreamErrorMessage(new Error("Boom"))).toBe(
      "The answer could not be completed."
    );
  });
});
