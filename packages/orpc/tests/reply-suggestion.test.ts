import { ORPCError } from "@orpc/server";
import type { suggestReply } from "@quieter/ai/suggest-reply";
import type { reportAiUsage } from "@quieter/billing";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import type { MessageListItem } from "@quieter/mail/messages";
import type { reportError } from "@quieter/observability";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { assertCanUseAi } from "../src/ai-access";
import type { loadAiAgentContext } from "../src/ai-memory";
import type { queriesMailOperations } from "../src/mail/queries";
import type { assertAccessibleMailbox } from "../src/mailbox/service";
import {
  replySuggestionInputSchema,
  requestReplySuggestion,
} from "../src/reply-suggestion";

const mocks = vi.hoisted(() => ({
  access: vi.fn<typeof assertAccessibleMailbox>(),
  billing: vi.fn<typeof assertCanUseAi>(),
  generate: vi.fn<typeof suggestReply>(),
  memory: vi.fn<typeof loadAiAgentContext>(),
  reportError: vi.fn<typeof reportError>(),
  reportUsage: vi.fn<typeof reportAiUsage>(),
  thread: vi.fn<(typeof queriesMailOperations)["getThread"]>(),
}));

vi.mock(import("../src/mailbox/service"), () => ({
  assertAccessibleMailbox: mocks.access,
}));
vi.mock(import("../src/ai-access"), () => ({ assertCanUseAi: mocks.billing }));
vi.mock(import("../src/mail/queries"), async (original) => {
  const actual = await original();
  return {
    queriesMailOperations: {
      ...actual.queriesMailOperations,
      getThread: mocks.thread,
    },
  };
});
vi.mock(import("../src/ai-memory"), async (original) => ({
  ...(await original()),
  loadAiAgentContext: mocks.memory,
}));
vi.mock(import("@quieter/ai/suggest-reply"), () => ({
  suggestReply: mocks.generate,
}));
vi.mock(import("@quieter/billing"), () => ({
  reportAiUsage: mocks.reportUsage,
}));
vi.mock(import("@quieter/observability"), async (original) => ({
  ...(await original()),
  reportError: mocks.reportError,
}));

const request = {
  context: { userId: "user-1" },
  input: {
    mailboxId: "mailbox-1",
    messageId: "message-1",
    threadId: "thread-1",
  },
};
const message = (
  overrides: Partial<MessageListItem> = {}
): MessageListItem => ({
  bodyText: "Could you clarify which document you need?",
  from: "sender@example.com",
  id: "message-1",
  internalDate: "1000",
  labelIds: ["INBOX"],
  threadId: "thread-1",
  ...overrides,
});
const usage = {
  cacheWriteTokens: 0,
  cachedTokens: 0,
  completionTokens: 20,
  costUsd: 0.01,
  promptTokens: 100,
};

describe("reply suggestion authorization and draft preparation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.access.mockResolvedValue({
      capabilities: getMailboxCapabilities({ provider: "gmail" }),
      contentRevision: 0,
      id: "mailbox-1",
      organizationId: "team-1",
      provider: "gmail",
    });
    mocks.billing.mockResolvedValue();
    mocks.memory.mockResolvedValue({ instructions: null, memory: null });
    mocks.thread.mockResolvedValue({
      messages: [message()],
      threadId: "thread-1",
    });
    mocks.reportUsage.mockResolvedValue();
    // oxlint-disable-next-line eslint/require-await -- The model stub reports usage synchronously.
    mocks.generate.mockImplementation(async (input) => {
      input.onUsage(usage);
      return {
        bodyText: "Please send the report.",
        status: "suggested",
      };
    });
  });

  test("rejects client-supplied content and identities", () => {
    expect(
      replySuggestionInputSchema.safeParse({
        ...request.input,
        bodyText: "Injected draft",
      }).success
    ).toBeFalsy();
    expect(
      replySuggestionInputSchema.safeParse({
        ...request.input,
        userId: "other-user",
      }).success
    ).toBeFalsy();
  });

  test("does not read mail or call AI without mailbox access", async () => {
    mocks.access.mockRejectedValue(new ORPCError("NOT_FOUND"));
    await expect(requestReplySuggestion(request)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mocks.thread).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.reportError).not.toHaveBeenCalled();
  });

  test("rejects managed mailbox readers before reading mail", async () => {
    mocks.access.mockResolvedValue({
      capabilities: getMailboxCapabilities({
        provider: "managed",
        role: "reader",
      }),
      contentRevision: 0,
      id: "mailbox-1",
      organizationId: "team-1",
      provider: "managed",
    });
    await expect(requestReplySuggestion(request)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.thread).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  test("requires AI billing access before reading mail or loading context", async () => {
    mocks.billing.mockRejectedValue(new ORPCError("FORBIDDEN"));
    await expect(requestReplySuggestion(request)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.thread).not.toHaveBeenCalled();
    expect(mocks.memory).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.reportError).not.toHaveBeenCalled();
  });

  test("preserves mailbox reconnection states without reporting expected failures", async () => {
    const error = new ORPCError("MAILBOX_SCOPE_REPAIR_REQUIRED", {
      message: "Reconnect this mailbox to continue.",
      status: 409,
    });
    mocks.thread.mockRejectedValue(error);
    await expect(requestReplySuggestion(request)).rejects.toBe(error);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.reportError).not.toHaveBeenCalled();
  });

  test.each([
    { messages: [message({ id: "other-message" })], threadId: "thread-1" },
    { messages: [message({ threadId: "other-thread" })], threadId: "thread-1" },
    { messages: [message()], threadId: "other-thread" },
  ])("rejects a message outside the requested thread", async (thread) => {
    mocks.thread.mockResolvedValue(thread);
    await expect(requestReplySuggestion(request)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.memory).not.toHaveBeenCalled();
  });

  test.each([
    message({ draftId: "draft-1" }),
    message({ labelIds: ["DRAFT"] }),
  ])("rejects unsent draft targets", async (draft) => {
    mocks.thread.mockResolvedValue({ messages: [draft], threadId: "thread-1" });
    await expect(requestReplySuggestion(request)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  test("does not generate a reply to the user's own sent message", async () => {
    mocks.thread.mockResolvedValue({
      messages: [message({ labelIds: ["SENT"] })],
      threadId: "thread-1",
    });
    await expect(requestReplySuggestion(request)).resolves.toMatchObject({
      status: "not_needed",
    });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  test("returns an editable body using only authorized non-draft conversation context", async () => {
    mocks.thread.mockResolvedValue({
      messages: [
        message(),
        message({ bodyText: "secret draft", draftId: "draft", id: "draft" }),
        message({
          bodyText: "other thread secret",
          id: "other",
          threadId: "other-thread",
        }),
        message({
          bodyText: "another secret draft",
          id: "draft-label",
          labelIds: ["DRAFT"],
        }),
      ],
      threadId: "thread-1",
    });
    await expect(requestReplySuggestion(request)).resolves.toMatchObject({
      bodyText: "Please send the report.",
      status: "suggested",
    });
    expect(mocks.thread.mock.calls[0]?.[0]).toMatchObject({
      context: { userId: "user-1" },
      input: { mailboxId: "mailbox-1", threadId: "thread-1" },
    });
    expect(mocks.generate.mock.calls[0]?.[0].messages).toHaveLength(1);
    expect(mocks.generate.mock.calls[0]?.[0].messages).toContainEqual(
      expect.objectContaining({ id: "message-1" })
    );
    expect(mocks.memory).toHaveBeenCalledWith(
      expect.objectContaining({ mailboxId: "mailbox-1", userId: "user-1" })
    );
    expect(mocks.reportUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        costUsd: usage.costUsd,
        mailboxId: "mailbox-1",
        userId: "user-1",
      })
    );
  });

  test("keeps the selected older message in bounded conversation context", async () => {
    const body = "Long message text ".repeat(10_000);
    mocks.thread.mockResolvedValue({
      messages: [
        message(),
        ...Array.from({ length: 50 }, (_, index) =>
          message({
            bodyText: body,
            id: `later-${index}`,
            internalDate: String(2000 + index),
          })
        ),
      ],
      threadId: "thread-1",
    });
    await requestReplySuggestion(request);
    const messages = mocks.generate.mock.calls[0]?.[0].messages ?? [];
    expect(messages.length).toBeLessThan(51);
    expect(messages).toContainEqual(
      expect.objectContaining({ id: "message-1" })
    );
    expect(
      messages.every((entry) => entry.bodyText.length < body.length)
    ).toBeTruthy();
  });

  test("reports usage even when generation fails and surfaces a generic error", async () => {
    // oxlint-disable-next-line eslint/require-await -- The failed model stub reports usage synchronously.
    mocks.generate.mockImplementation(async (input) => {
      input.onUsage(usage);
      throw new Error("provider detail with private data");
    });
    await expect(requestReplySuggestion(request)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(mocks.reportUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        costUsd: usage.costUsd,
        mailboxId: "mailbox-1",
      })
    );
    expect(mocks.reportError).toHaveBeenCalledWith(expect.any(Error), {
      operation: "ai:suggest-reply",
    });
    const reported = mocks.reportError.mock.calls[0]?.[0];
    expect(
      reported instanceof Error && reported.message.includes("private data")
    ).toBeFalsy();
  });

  test("preserves a no-reply-needed decision", async () => {
    mocks.generate.mockResolvedValue({
      reason: "The conversation is complete.",
      status: "not_needed",
    });
    await expect(requestReplySuggestion(request)).resolves.toMatchObject({
      status: "not_needed",
    });
  });
});
