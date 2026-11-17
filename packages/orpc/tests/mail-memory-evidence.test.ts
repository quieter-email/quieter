import { ORPCError } from "@orpc/server";
import {
  mailbox,
  mailboxGrant,
  mailboxDivisionGrant,
  member,
} from "@quieter/database/schema";
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
import type { PreparedGmailMailboxIdentity } from "../src/gmail-mailbox-access";
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
  directGrant: false,
  divisionGrant: false,
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
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === mailbox) {
              return await state.lookup();
            }
            if (table === member) {
              return [{ id: "fixture-member" }];
            }
            if (
              (table === mailboxGrant && state.directGrant) ||
              (table === mailboxDivisionGrant && state.divisionGrant)
            ) {
              return [{ id: "other-grant" }];
            }
            return [];
          },
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
    request: (
      token: string,
      identity: PreparedGmailMailboxIdentity
    ) => Promise<TValue>
  ): Promise<TValue> =>
    await request("test-token", {
      googleSubject: "fixture-subject",
      mailboxId: _input.mailboxId,
    }),
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
    state.directGrant = false;
    state.divisionGrant = false;
    state.record.mockReset().mockResolvedValue(null);
    state.lookup
      .mockReset()
      .mockImplementation(async () => (state.selected ? [state.selected] : []));
    state.report.mockReset();
    state.getMessage.mockReset().mockResolvedValue(message);
    state.isGenerated.mockReset().mockResolvedValue(false);
    state.authorizeManaged.mockReset();
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

  test("shared mailboxes do not enter personal learning even for an authorized actor", async () => {
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
    expect(state.record).not.toHaveBeenCalled();
    await queueMailboxMessageMemory({
      mailboxId: "mailbox-1",
      messageIds: [message.id],
      userId: "reader-1",
    });
    expect(state.record).not.toHaveBeenCalled();
  });

  test.each(["direct", "division"])(
    "a private-mode inbox with another %s grant stops before personal evidence preparation",
    async (grant) => {
      state.selected = {
        ...state.selected,
        accessMode: "private",
        emailAddress: "managed@example.test",
        id: "mailbox-1",
        managedOwnerUserId: "owner-1",
        ownerUserId: null,
        provider: "managed",
      };
      state.directGrant = grant === "direct";
      state.divisionGrant = grant === "division";
      state.authorizeManaged.mockResolvedValue({
        contentRevision: 0,
        displayName: null,
        emailAddress: "managed@example.test",
        id: "mailbox-1",
        organizationId: "organization-1",
        ownerUserId: "owner-1",
        provider: "managed",
        role: "manager",
      });

      await expect(
        captureMailboxMessageMemory({
          actorUserId: "owner-1",
          mailboxId: "mailbox-1",
          message: { ...message, labelIds: ["SENT"] },
          source: "received",
        })
      ).resolves.toBeNull();
      expect(state.record).not.toHaveBeenCalled();
      expect(state.isGenerated).not.toHaveBeenCalled();
    }
  );

  test("shared outbound writing does not enter personal learning", async () => {
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
