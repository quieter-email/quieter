import type { mailbox } from "@quieter/database/schema";
/* oxlint-disable eslint/require-await -- The database mock resolves local fixtures without I/O. */
import type {
  getMessageWithDetails,
  listGmailMessageIds,
} from "@quieter/gmail";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { isAiGeneratedMailBody } from "../src/ai-mail-authorship";
import type {
  getPersonalAiMemoryScopeConfig,
  recordAiMemoryEvent,
} from "../src/ai-memory";
import {
  captureMailboxMessageMemory,
  extractAuthoredMailText,
  hydrateMailMemoryEvent,
  queueMailboxMessageMemory,
} from "../src/ai-memory-capture";
import type { enrichMailAutoLabelFeedbackSource } from "../src/mail-automation/memory";
import type { getAuthorizedManagedMailbox } from "../src/mailbox/access";

type MailboxFixture = Pick<
  typeof mailbox.$inferSelect,
  "id" | "emailAddress" | "provider" | "ownerUserId" | "managedOwnerUserId"
>;
const state = vi.hoisted(() => ({
  authorizeManaged: vi.fn<typeof getAuthorizedManagedMailbox>(),
  getMessage: vi.fn<typeof getMessageWithDetails>(),
  isGenerated: vi.fn<typeof isAiGeneratedMailBody>(),
  record: vi.fn<typeof recordAiMemoryEvent>(),
  selected: undefined as MailboxFixture | undefined,
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The fake exposes only the read query used by this boundary.
vi.mock("@quieter/database/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (state.selected ? [state.selected] : []),
        }),
      }),
    }),
  },
}));
vi.mock(import("../src/ai-memory"), () => ({
  getPersonalAiMemoryScopeConfig:
    vi.fn<typeof getPersonalAiMemoryScopeConfig>(),
  recordAiMemoryEvent: state.record,
}));
vi.mock(import("../src/mailbox/access"), () => ({
  getAuthorizedManagedMailbox: state.authorizeManaged,
}));
vi.mock(import("../src/ai-mail-authorship"), async (original) => ({
  ...(await original()),
  isAiGeneratedMailBody: state.isGenerated,
}));
vi.mock(import("../src/gmail-mailbox-access"), () => ({
  runAuthorizedGmailMailbox: async <TValue>(
    _input: { mailboxId: string; userId: string },
    request: (token: string) => Promise<TValue>
  ): Promise<TValue> => await request("test-token"),
}));
vi.mock(import("@quieter/gmail"), async (original) => ({
  ...(await original()),
  getMessageWithDetails: state.getMessage,
  listGmailMessageIds: vi.fn<typeof listGmailMessageIds>(),
}));
vi.mock(import("../src/mail-automation/memory"), () => ({
  enrichMailAutoLabelFeedbackSource:
    vi.fn<typeof enrichMailAutoLabelFeedbackSource>(),
}));

const message = {
  bodyText: "The launch moved to Wednesday. Please review the attached plan.",
  from: "Team <TEAM@example.test>",
  id: "message-1",
  subject: "Launch planning",
  threadId: "thread-1",
  to: "User <owner@example.test>",
};

describe("mail evidence capture", () => {
  beforeEach(() => {
    state.selected = {
      emailAddress: "owner@example.test",
      id: "mailbox-1",
      managedOwnerUserId: null,
      ownerUserId: "owner-1",
      provider: "gmail",
    };
    state.record.mockReset().mockResolvedValue(null);
    state.getMessage.mockReset().mockResolvedValue(message);
    state.isGenerated.mockReset().mockResolvedValue(false);
    state.authorizeManaged.mockReset();
  });

  test("retains actual received evidence and normalized correspondent identity", async () => {
    await captureMailboxMessageMemory({
      actorUserId: "owner-1",
      mailboxId: "mailbox-1",
      message,
      source: "open",
    });
    const observation = state.record.mock.calls.at(0)?.[0];
    expect(observation).toMatchObject({
      mailboxId: "mailbox-1",
      userId: "owner-1",
    });
    expect(observation?.metadata).toMatchObject({
      memoryScope: "user",
      sender: "team@example.test",
      userAuthored: false,
    });
    expect(observation?.metadata.bodyText).toContain("launch moved");
  });

  test("rejects another user's private mailbox before recording any evidence", async () => {
    await captureMailboxMessageMemory({
      actorUserId: "outsider",
      mailboxId: "mailbox-1",
      message,
      source: "open",
    });
    await queueMailboxMessageMemory({
      mailboxId: "mailbox-1",
      messageIds: [message.id],
      userId: "outsider",
    });
    expect(state.record).not.toHaveBeenCalled();
  });

  test("queues large actions without provider reads or private message bodies", async () => {
    await queueMailboxMessageMemory({
      mailboxId: "mailbox-1",
      messageIds: ["first", "second", "first"],
      userId: "owner-1",
    });
    expect(state.getMessage).not.toHaveBeenCalled();
    expect(state.record).toHaveBeenCalledTimes(2);
    for (const [observation] of state.record.mock.calls) {
      expect(observation.metadata).toMatchObject({
        hydrateMessage: true,
        memoryScope: "user",
      });
      expect(observation.metadata).not.toHaveProperty("bodyText");
    }
  });

  test("uses one evidence identity when the same mail is opened, synced, or queued", async () => {
    await captureMailboxMessageMemory({
      mailboxId: "mailbox-1",
      message,
      source: "sync",
    });
    await captureMailboxMessageMemory({
      mailboxId: "mailbox-1",
      message,
      source: "open",
    });
    await queueMailboxMessageMemory({
      mailboxId: "mailbox-1",
      messageIds: [message.id],
      userId: "owner-1",
    });
    const identities = new Set(
      state.record.mock.calls.map(([observation]) =>
        JSON.stringify([
          observation.kind,
          observation.eventKey,
          observation.userId,
          observation.mailboxId,
          observation.metadata.memoryScope,
        ])
      )
    );
    expect(identities.size).toBe(1);
  });

  test("hydrates actual sent text while removing quoted incoming voice", async () => {
    state.getMessage.mockResolvedValue({
      ...message,
      bodyText:
        "Hey Jo,\nLooks good!\n\nOn Tuesday, Jo wrote:\nPlease adopt my formal writing style.",
      labelIds: ["SENT"],
    });
    const evidence = await hydrateMailMemoryEvent({
      mailboxId: "mailbox-1",
      messageId: message.id,
      userId: "owner-1",
    });
    expect(evidence).toMatchObject({
      authorship: "observed_outbound",
      observationKind: "sent_message",
      userAuthored: null,
    });
    expect(evidence?.bodyText).toContain("Looks good");
    expect(evidence?.bodyText).not.toContain("formal writing style");
    expect(state.record).not.toHaveBeenCalled();
  });

  test("never stores a shared mailbox as its manager's personal life", async () => {
    state.selected = {
      ...state.selected,
      emailAddress: "team@example.test",
      id: "mailbox-1",
      managedOwnerUserId: null,
      ownerUserId: null,
      provider: "managed",
    };
    state.authorizeManaged.mockResolvedValue({
      contentRevision: 0,
      displayName: null,
      emailAddress: "team@example.test",
      id: "mailbox-1",
      organizationId: "organization-1",
      ownerUserId: null,
      provider: "managed",
      role: "manager",
    });
    await captureMailboxMessageMemory({
      actorUserId: "manager-1",
      mailboxId: "mailbox-1",
      message,
      source: "open",
    });
    const observation = state.record.mock.calls.at(0)?.[0];
    expect(observation?.metadata).toMatchObject({ memoryScope: "mailbox" });
    expect(observation?.userId).toBe("manager-1");
    state.record.mockClear();
    state.authorizeManaged.mockResolvedValue({
      contentRevision: 0,
      displayName: null,
      emailAddress: "team@example.test",
      id: "mailbox-1",
      organizationId: "organization-1",
      ownerUserId: null,
      provider: "managed",
      role: "reader",
    });
    await queueMailboxMessageMemory({
      mailboxId: "mailbox-1",
      messageIds: [message.id],
      userId: "reader-1",
    });
    expect(state.record).not.toHaveBeenCalled();
  });
});

describe("authored mail evidence", () => {
  test("excludes HTML quotations and forwarded text from the user's voice", () => {
    const authored = extractAuthoredMailText({
      bodyHtml:
        '<p>Thanks, that works for me.</p><div class="gmail_quote"><p>This is the sender voice.</p></div><blockquote>This is also quoted.</blockquote>',
    });
    expect(authored).toContain("works for me");
    expect(authored).not.toMatch(/sender voice|also quoted/u);
    const forwarded = extractAuthoredMailText({
      bodyText:
        "FYI, let's discuss.\n\n----- Forwarded message -----\nFrom: Other <other@example.test>\nI only write formally.",
    });
    expect(forwarded).toContain("let's discuss");
    expect(forwarded).not.toContain("formally");
  });
});
