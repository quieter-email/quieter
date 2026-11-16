import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { buildComposeMessageQuotes } from "@quieter/mail/compose/message-quote";
import { composeMessageEnvelopeSchema } from "@quieter/mail/compose/schema";
import { getAuthoredSnippetContent } from "@quieter/mail/compose/snippet-quotes";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { MailEffectAssertion } from "../src/gmail-request";
import { composeMailOperations } from "../src/mail/compose";
import type { withMailComposeLock } from "../src/mail/compose-lock";
import type { captureMailSendIntentAuthority } from "../src/mail/intent-authority";
import {
  composeSnippetQuoteProofSchema,
  hashComposeSnippetBody,
} from "../src/mail/snippet-quote-provenance";
import type { assertAccessibleMailbox } from "../src/mailbox/service";
import type { sendManagedMailboxMessage } from "../src/managed-mail/messages/send";
import type {
  assertComposeNotScheduled,
  assertComposeSendAttemptActive,
  resolveComposeSourceDraftId,
} from "../src/scheduled-send/reservation";

const fixture = vi.hoisted(() => {
  const state: {
    beforeDispatch?: (
      message: Parameters<typeof sendManagedMailboxMessage>[0]["message"]
    ) => void;
    writes: number;
  } = { writes: 0 };
  return {
    access: vi.fn<typeof assertAccessibleMailbox>(),
    beforeEffect: vi.fn<MailEffectAssertion>(),
    intent: vi.fn<typeof captureMailSendIntentAuthority>(),
    query:
      vi.fn<
        (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
      >(),
    send: vi.fn<typeof sendManagedMailboxMessage>(),
    state,
  };
});

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The provider boundary receives a real query executor without database I/O in this fixture.
vi.mock("@quieter/database/client", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const database = drizzle(fixture.query);
  return {
    db: Object.assign(database, {
      transaction: async <Result>(
        run: (transaction: typeof database) => Promise<Result>
      ) => await run(database),
    }),
  };
});
vi.mock(import("../src/mailbox/service"), () => ({
  assertAccessibleMailbox: fixture.access,
}));
vi.mock(import("../src/mail/intent-authority"), () => ({
  captureMailSendIntentAuthority: fixture.intent,
}));
vi.mock(import("../src/managed-mail/messages/send"), () => ({
  sendManagedMailboxMessage: fixture.send,
}));
vi.mock(import("../src/mail/compose-lock"), () => ({
  withMailComposeLock: async <T>(
    ...[_mailboxId, _identity, run]: Parameters<typeof withMailComposeLock<T>>
  ) => await run(),
}));
vi.mock(import("../src/scheduled-send/reservation"), () => ({
  assertComposeNotScheduled: vi
    .fn<typeof assertComposeNotScheduled>()
    .mockResolvedValue(),
  assertComposeSendAttemptActive: vi
    .fn<typeof assertComposeSendAttemptActive>()
    .mockResolvedValue(),
  resolveComposeSourceDraftId: vi
    .fn<typeof resolveComposeSourceDraftId>()
    .mockResolvedValue(null),
}));

const binding = {
  actorUserId: "owner",
  mailboxId: "mailbox",
  sendOperationId: "18cba911-a53c-4555-a8bd-c03394db8335",
};
const prepare = () => {
  const source = {
    bodyHtml: "<p>Inherited {{?field}}</p>",
    bodyText: "Inherited {{?field}}",
    from: "sender@example.test",
    id: "source",
    threadId: "thread",
  };
  const quote = buildComposeMessageQuotes(source);
  const message = composeMessageEnvelopeSchema.parse({
    attachments: [],
    bodyHtml: `<p>Reply.</p>${quote.replyHtml}`,
    bodyText: `Reply.\n\n${quote.replyText}`,
    draftAnchor: {
      seededBy: "reply",
      sourceMessageId: source.id,
      sourceThreadId: source.threadId,
    },
    inlineImages: [],
    localId: "local",
    recipients: { bcc: "", cc: "", to: "recipient@example.test" },
    saveStatus: "idle",
    sendOperationId: binding.sendOperationId,
    subject: "Reply",
    updatedAt: Date.now(),
  });
  const snippetQuote = composeSnippetQuoteProofSchema.parse({
    ...binding,
    ...getAuthoredSnippetContent(message, source),
    bodyHash: hashComposeSnippetBody(message),
    source: {
      mailboxId: binding.mailboxId,
      messageId: source.id,
      seededBy: "reply",
      threadId: source.threadId,
    },
    version: 1,
  });
  return {
    context: {
      beforeEffect: fixture.beforeEffect,
      snippetQuote,
      userId: binding.actorUserId,
    },
    input: { mailboxId: binding.mailboxId, message },
  };
};

describe("captured snippet provenance at final compose dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.state.beforeDispatch = undefined;
    fixture.state.writes = 0;
    fixture.beforeEffect.mockResolvedValue();
    fixture.access.mockResolvedValue({
      capabilities: getMailboxCapabilities({
        provider: "managed",
        role: "responder",
      }),
      contentRevision: 0,
      id: binding.mailboxId,
      organizationId: "organization",
      provider: "managed",
    });
    fixture.intent.mockImplementation(async ({ origin }) => {
      await Promise.resolve();
      return { learning: null, operation: origin };
    });
    fixture.send.mockImplementation(async ({ context, message }) => {
      await Promise.resolve();
      fixture.state.beforeDispatch?.(message);
      await db.transaction(async (executor) => {
        await context?.beforeEffect?.(executor);
      });
      fixture.state.writes += 1;
      return {
        draftCleanupHandled: true,
        id: "accepted",
        idempotent: false,
        messageId: "<accepted@example.test>",
        threadId: "thread",
      };
    });
  });

  test("a valid captured proof reaches the provider with unchanged quoted bodies and the same effect executor", async () => {
    const request = prepare();
    await expect(
      composeMailOperations.sendMessage(request)
    ).resolves.toMatchObject({ id: "accepted" });
    expect(fixture.beforeEffect).toHaveBeenCalledWith(db);
    expect(fixture.state.writes).toBe(1);
    expect(fixture.send.mock.calls[0]?.[0].message.bodyHtml).toContain(
      "{{?field}}"
    );
  });

  test("missing proof rejects before provider preparation", async () => {
    const request = prepare();
    await expect(
      composeMailOperations.sendMessage({
        ...request,
        context: { userId: binding.actorUserId },
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { sendNotStarted: true },
    });
    expect(fixture.send).not.toHaveBeenCalled();
    expect(fixture.state.writes).toBe(0);
  });

  test("a body changed during asynchronous provider preparation is denied again at the effect boundary", async () => {
    fixture.state.beforeDispatch = (message) => {
      message.bodyText = "{{?late-change}}";
    };
    await expect(
      composeMailOperations.sendMessage(prepare())
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { sendNotStarted: true },
    });
    expect(fixture.beforeEffect).toHaveBeenCalledWith(db);
    expect(fixture.state.writes).toBe(0);
  });

  test("a current request guard can still deny a valid captured quote", async () => {
    fixture.beforeEffect.mockRejectedValue(new ORPCError("FORBIDDEN"));
    await expect(
      composeMailOperations.sendMessage(prepare())
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.state.writes).toBe(0);
  });
});
