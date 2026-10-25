import { ORPCError } from "@orpc/server";
import type { mailbox } from "@quieter/database/schema";
/* oxlint-disable eslint/require-await -- The database mock resolves local fixtures without I/O. */
import type {
  getMessageWithDetails,
  listGmailMessageIds,
} from "@quieter/gmail";
import type { reportError } from "@quieter/observability";
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
  | "id"
  | "accessMode"
  | "emailAddress"
  | "provider"
  | "ownerUserId"
  | "managedOwnerUserId"
>;
const state = vi.hoisted(() => ({
  authorizeManaged: vi.fn<typeof getAuthorizedManagedMailbox>(),
  getMessage: vi.fn<typeof getMessageWithDetails>(),
  isGenerated: vi.fn<typeof isAiGeneratedMailBody>(),
  lookup: vi.fn<() => Promise<MailboxFixture[]>>(),
  record: vi.fn<typeof recordAiMemoryEvent>(),
  report: vi.fn<typeof reportError>(),
  selected: undefined as MailboxFixture | undefined,
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The fake exposes only the read query used by this boundary.
vi.mock("@quieter/database/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: state.lookup,
        }),
      }),
    }),
  },
}));
vi.mock(import("@quieter/observability"), () => ({
  reportError: state.report,
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
      accessMode: "private",
      emailAddress: "owner@example.test",
      id: "mailbox-1",
      managedOwnerUserId: null,
      ownerUserId: "owner-1",
      provider: "gmail",
    };
    state.record.mockReset().mockResolvedValue(null);
    state.lookup
      .mockReset()
      .mockImplementation(async () => (state.selected ? [state.selected] : []));
    state.report.mockReset();
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
      });
      expect(observation.metadata).not.toHaveProperty("bodyText");
    }
  });

  test("keeps message evidence deduplicated while preserving separate engagement", async () => {
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
    await captureMailboxMessageMemory({
      mailboxId: "mailbox-1",
      message,
      source: "ai_read",
    });
    await queueMailboxMessageMemory({
      mailboxId: "mailbox-1",
      messageIds: [message.id],
      userId: "owner-1",
    });
    const content = state.record.mock.calls.filter(
      ([observation]) => observation.metadata.messageContextOnly !== true
    );
    const identities = new Set(
      content.map(([observation]) =>
        JSON.stringify([
          observation.kind,
          observation.eventKey,
          observation.userId,
          observation.mailboxId,
        ])
      )
    );
    expect(identities.size).toBe(1);
    const engagement = state.record.mock.calls
      .map(([observation]) => observation)
      .filter(
        (observation) => observation.metadata.messageContextOnly === true
      );
    expect(engagement).toHaveLength(2);
    expect(engagement.map((observation) => observation.eventKey)).not.toContain(
      content[0]?.[0].eventKey
    );
    expect(engagement.map((observation) => observation.metadata)).toMatchObject(
      expect.arrayContaining([
        expect.objectContaining({ action: "open", source: "open" }),
        expect.objectContaining({ action: "ai_read", source: "ai_read" }),
      ])
    );
  });

  test.each(["owner-1", null])(
    "skips inaccessible managed mail without blocking durable captures, owner %s",
    async (managedOwnerUserId) => {
      state.selected = {
        ...state.selected,
        accessMode: managedOwnerUserId === null ? "shared" : "private",
        emailAddress: "managed@example.test",
        id: "mailbox-1",
        managedOwnerUserId,
        ownerUserId: null,
        provider: "managed",
      };
      state.authorizeManaged.mockRejectedValue(new ORPCError("NOT_FOUND"));
      for (const source of ["received", "sync", "bootstrap"] as const) {
        await expect(
          captureMailboxMessageMemory({
            actorUserId: managedOwnerUserId ?? "manager-1",
            mailboxId: "mailbox-1",
            message,
            source,
          })
        ).resolves.toBeNull();
      }
      expect(state.record).not.toHaveBeenCalled();
      expect(state.report).not.toHaveBeenCalled();
    }
  );

  test.each(["received", "sync", "bootstrap"] as const)(
    "preserves retryable recording failures for %s captures",
    async (source) => {
      const error = new Error("Database connection failed");
      state.record.mockRejectedValue(error);
      await expect(
        captureMailboxMessageMemory({
          mailboxId: "mailbox-1",
          message,
          source,
        })
      ).rejects.toBe(error);
      expect(state.report).toHaveBeenCalledOnce();
    }
  );

  test("preserves unexpected managed authorization failures on durable capture", async () => {
    state.selected = {
      ...state.selected,
      accessMode: "private",
      emailAddress: "managed@example.test",
      id: "mailbox-1",
      managedOwnerUserId: "owner-1",
      ownerUserId: null,
      provider: "managed",
    };
    const error = new ORPCError("INTERNAL_SERVER_ERROR");
    state.authorizeManaged.mockRejectedValue(error);
    await expect(
      captureMailboxMessageMemory({
        mailboxId: "mailbox-1",
        message,
        source: "received",
      })
    ).rejects.toBe(error);
    expect(state.record).not.toHaveBeenCalled();
  });

  test("contains mailbox lookup failures when queuing after a mail action", async () => {
    const error = new Error("Database query included private mailbox data");
    state.lookup.mockRejectedValue(error);
    await expect(
      queueMailboxMessageMemory({
        mailboxId: "mailbox-1",
        messageIds: [message.id],
        userId: "owner-1",
      })
    ).resolves.toBeUndefined();
    expect(state.record).not.toHaveBeenCalled();
    expect(state.report).toHaveBeenCalledOnce();
    expect(String(state.report.mock.calls.at(0)?.[0])).not.toContain(
      error.message
    );
  });

  test("attempts remaining message captures after a queue failure", async () => {
    state.record.mockRejectedValueOnce(new Error("Temporary database failure"));
    await expect(
      queueMailboxMessageMemory({
        mailboxId: "mailbox-1",
        messageIds: ["first", "second", "first"],
        userId: "owner-1",
      })
    ).resolves.toBeUndefined();
    expect(state.record).toHaveBeenCalledTimes(2);
    expect(
      state.record.mock.calls.map(([event]) => event.metadata.messageId)
    ).toContain("second");
    expect(state.report).toHaveBeenCalledOnce();
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

  test("captures a shared mailbox only for an explicit authorized actor", async () => {
    state.selected = {
      ...state.selected,
      accessMode: "shared",
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
      role: "reader",
    });
    await captureMailboxMessageMemory({
      mailboxId: "mailbox-1",
      message,
      source: "received",
    });
    expect(state.record).not.toHaveBeenCalled();
    await captureMailboxMessageMemory({
      actorUserId: "reader-1",
      mailboxId: "mailbox-1",
      message,
      source: "open",
    });
    expect(state.record.mock.calls.at(0)?.[0]).toMatchObject({
      mailboxId: "mailbox-1",
      userId: "reader-1",
    });
    state.record.mockClear();
    await queueMailboxMessageMemory({
      mailboxId: "mailbox-1",
      messageIds: [message.id],
      userId: "reader-1",
    });
    expect(state.record.mock.calls.at(0)?.[0].userId).toBe("reader-1");
  });

  test("does not attribute shared outbound writing to the reader", async () => {
    state.selected = {
      accessMode: "shared",
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
      role: "reader",
    });
    await captureMailboxMessageMemory({
      actorUserId: "reader-1",
      mailboxId: "mailbox-1",
      message: { ...message, labelIds: ["SENT"] },
      source: "ai_read",
    });
    expect(state.record.mock.calls.at(0)?.[0].metadata).toMatchObject({
      authorship: "unattributed_outbound",
      userAuthored: false,
    });
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
