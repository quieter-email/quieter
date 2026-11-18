import { ORPCError } from "@orpc/server";
import { buildComposeMessageQuotes } from "@quieter/mail/compose/message-quote";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { REQUIRED_GMAIL_SCOPES } from "../src/gmail-mailbox-access";
import type { getAuthorizedGmailMailbox } from "../src/gmail-mailbox-access";
import type { assertAgentMailboxAccess } from "../src/mail-agent/access";
import {
  getComposeSendReadiness,
  prepareComposeSnippetAdmission,
} from "../src/mail/compose-readiness";
import type { queriesMailOperations } from "../src/mail/queries";
import type { assertAccessibleMailbox } from "../src/mailbox/service";

const fixture = vi.hoisted(() => {
  const state: {
    googleSubject: string;
    granted: boolean;
    provider: "gmail" | "managed";
    scopes: string;
    status: "connected" | "needs_reconnect";
  } = {
    googleSubject: "subject",
    granted: true,
    provider: "managed",
    scopes: "",
    status: "connected",
  };
  return {
    access: vi.fn<typeof assertAgentMailboxAccess>(),
    authorize: vi.fn<typeof assertAccessibleMailbox>(),
    prepare: vi.fn<typeof getAuthorizedGmailMailbox>(),
    query:
      vi.fn<
        (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
      >(),
    state,
    thread: vi.fn<typeof queriesMailOperations.getThread>(),
  };
});

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The proxy retains the exact native lock and credential query builders.
vi.mock("@quieter/database/client", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const database = drizzle(fixture.query);
  return {
    db: Object.assign(database, {
      transaction: async <T>(operation: (tx: typeof database) => Promise<T>) =>
        await operation(database),
    }),
  };
});
vi.mock(import("../src/mailbox/service"), () => ({
  assertAccessibleMailbox: fixture.authorize,
}));
vi.mock(import("../src/mail-agent/access"), () => ({
  assertAgentMailboxAccess: fixture.access,
}));
vi.mock(import("../src/gmail-mailbox-access"), async (original) => ({
  ...(await original()),
  getAuthorizedGmailMailbox: fixture.prepare,
}));
vi.mock(import("../src/mail/queries"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    queriesMailOperations: {
      ...actual.queriesMailOperations,
      getThread: fixture.thread,
    },
  };
});

const source = {
  bodyHtml: "<p>Received {{?received}}</p>",
  bodyText: "Received {{?received}}",
  from: "Sender <sender@example.test>",
  id: "message",
  internalDate: "1794787200000",
  subject: "Received subject",
  threadId: "thread",
  to: "Reader <reader@example.test>",
};
const context = { userId: "reader" };
const request = () => {
  const quotes = buildComposeMessageQuotes(source);
  return {
    bodyHtml: `<p>My response.</p>${quotes.replyHtml}`,
    bodyText: `My response.\n\n${quotes.replyText}`,
    draftAnchor: {
      seededBy: "reply" as const,
      sourceMessageId: source.id,
      sourceThreadId: source.threadId,
    },
    inlineImages: [],
    mailboxId: "mailbox",
  };
};

describe("authenticated passive compose readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.state.googleSubject = "subject";
    fixture.state.granted = true;
    fixture.state.provider = "managed";
    fixture.state.scopes = REQUIRED_GMAIL_SCOPES.join(" ");
    fixture.state.status = "connected";
    fixture.authorize.mockImplementation(async () => {
      await Promise.resolve();
      if (!fixture.state.granted) {
        throw new ORPCError("NOT_FOUND");
      }
      return {
        capabilities: getMailboxCapabilities({
          provider: fixture.state.provider,
          role: "reader",
        }),
        contentRevision: 0,
        id: "mailbox",
        organizationId: "organization",
        provider: fixture.state.provider,
      };
    });
    fixture.access.mockImplementation(async (input) => {
      await Promise.resolve();
      if (!fixture.state.granted || input.saveDraft === true) {
        throw new ORPCError("NOT_FOUND");
      }
      return {
        canSaveDraft: false,
        memberId: "member",
        organizationId: "organization",
        provider: fixture.state.provider,
        shared: true,
      };
    });
    fixture.prepare.mockResolvedValue({
      accessToken: "synthetic",
      mailbox: {
        accessTokenExpiresAt: new Date(Date.now() + 60_000),
        emailAddress: "reader@example.test",
        encryptedAccessToken: "encrypted",
        encryptedRefreshToken: "encrypted-refresh",
        googleSubject: "subject",
        id: "mailbox",
        scopes: REQUIRED_GMAIL_SCOPES.join(" "),
        status: "connected",
      },
      markNeedsReconnect: vi.fn<() => Promise<void>>().mockResolvedValue(),
    });
    fixture.query.mockImplementation(async (query) => {
      await Promise.resolve();
      return {
        rows: query.includes('from "gmailCredential"')
          ? [[fixture.state.googleSubject, fixture.state.scopes]]
          : [[fixture.state.provider, fixture.state.status]],
      };
    });
    fixture.thread.mockResolvedValue({
      messages: [source],
      threadId: source.threadId,
    });
  });

  test("a managed reader can check canonical quotes without obtaining source content in the response", async () => {
    await expect(
      getComposeSendReadiness({ context, input: request() })
    ).resolves.toStrictEqual({ unresolvedSnippetFields: [] });
    expect(fixture.thread).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { mailboxId: "mailbox", threadId: source.threadId },
        recordActivity: false,
      })
    );
    expect(fixture.prepare).not.toHaveBeenCalled();
    const proof = await prepareComposeSnippetAdmission({
      context,
      mailboxId: "mailbox",
      message: request(),
      sendOperationId: "operation",
    });
    expect(proof).toMatchObject({
      actorUserId: context.userId,
      mailboxId: "mailbox",
      sendOperationId: "operation",
      source: { messageId: source.id, threadId: source.threadId },
    });
  });

  test("authored markers remain unresolved even when they repeat a canonical quote token", async () => {
    const input = request();
    input.bodyHtml = `<p>{{?received}} {{?authored}}</p>${input.bodyHtml}`;
    input.bodyText = `{{?received}} {{?authored}}\n${input.bodyText}`;
    const result = await getComposeSendReadiness({ context, input });
    expect(result.unresolvedSnippetFields).toContain("received");
    expect(result.unresolvedSnippetFields).toContain("authored");
    await expect(
      prepareComposeSnippetAdmission({
        context,
        mailboxId: input.mailboxId,
        message: input,
        sendOperationId: "operation",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { sendNotStarted: true },
    });
  });

  test.each(["missing", "foreign-thread", "draft"] as const)(
    "an unavailable %s source earns no exemption",
    async (kind) => {
      if (kind === "missing") {
        fixture.thread.mockRejectedValue(new ORPCError("NOT_FOUND"));
      }
      if (kind === "foreign-thread") {
        fixture.thread.mockResolvedValue({
          messages: [{ ...source, threadId: "foreign" }],
          threadId: "foreign",
        });
      }
      if (kind === "draft") {
        fixture.thread.mockResolvedValue({
          messages: [{ ...source, draftId: "draft", labelIds: ["DRAFT"] }],
          threadId: source.threadId,
        });
      }
      const result = await getComposeSendReadiness({
        context,
        input: request(),
      });
      expect(result.unresolvedSnippetFields).toContain("received");
    }
  );

  test.each([false, true])(
    "grant loss during the passive read stays an authorization failure, sourceMissing=%s",
    async (missing) => {
      fixture.thread.mockImplementation(async () => {
        await Promise.resolve();
        fixture.state.granted = false;
        if (missing) {
          throw new ORPCError("NOT_FOUND");
        }
        return { messages: [source], threadId: source.threadId };
      });
      await expect(
        getComposeSendReadiness({ context, input: request() })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  );

  test("an unchanged prepared Gmail account can validate its quote", async () => {
    fixture.state.provider = "gmail";
    await expect(
      getComposeSendReadiness({ context, input: request() })
    ).resolves.toMatchObject({ unresolvedSnippetFields: [] });
  });

  test("a caller's prepared account identity cannot be replaced by quote preparation", async () => {
    fixture.state.provider = "gmail";
    await expect(
      getComposeSendReadiness({
        context: {
          ...context,
          gmailIdentity: {
            googleSubject: "original-account",
            mailboxId: "mailbox",
          },
        },
        input: request(),
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(fixture.thread).not.toHaveBeenCalled();
  });

  test.each(["subject", "status", "scopes"] as const)(
    "rechecks prepared Gmail %s after the canonical read",
    async (change) => {
      fixture.state.provider = "gmail";
      fixture.thread.mockImplementation(async () => {
        await Promise.resolve();
        if (change === "subject") {
          fixture.state.googleSubject = "replacement";
        }
        if (change === "status") {
          fixture.state.status = "needs_reconnect";
        }
        if (change === "scopes") {
          fixture.state.scopes = "openid";
        }
        return { messages: [source], threadId: source.threadId };
      });
      await expect(
        getComposeSendReadiness({ context, input: request() })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
  );

  test("a strict body without markers does not load any quote source", async () => {
    const input = {
      ...request(),
      bodyHtml: "<p>My response.</p>",
      bodyText: "My response.",
    };
    await expect(
      getComposeSendReadiness({ context, input })
    ).resolves.toMatchObject({ unresolvedSnippetFields: [] });
    expect(fixture.thread).not.toHaveBeenCalled();
    expect(fixture.prepare).not.toHaveBeenCalled();
  });
});
