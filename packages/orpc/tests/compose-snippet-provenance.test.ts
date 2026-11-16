import { ORPCError } from "@orpc/server";
import { buildComposeMessageQuotes } from "@quieter/mail/compose/message-quote";
import { normalizeComposeBodyHtml } from "@quieter/mail/compose/mime";
import {
  composeMessageEnvelopeSchema,
  composeMessageInputSchema,
} from "@quieter/mail/compose/schema";
import { getAuthoredSnippetContent } from "@quieter/mail/compose/snippet-quotes";
import { describe, expect, test } from "vite-plus/test";

import {
  assertComposeSnippetFieldsResolved,
  composeSendReadinessInputSchema,
  composeSnippetQuoteProofSchema,
  hashComposeSnippetBody,
} from "../src/mail/snippet-quote-provenance";
import {
  captureScheduledSendPayload,
  hashScheduledSendPayload,
  readScheduledSendPayload,
  restoreScheduledSendPayload,
} from "../src/scheduled-send/payload";

const source = {
  bodyHtml: "<p>Inherited {{?received}} and {{@context}}.</p>",
  bodyText: "Inherited {{?received}} and {{@context}}.",
  from: "Sender <sender@example.test>",
  id: "source-message",
  internalDate: "1794787200000",
  subject: "Received subject",
  threadId: "source-thread",
  to: "Reader <reader@example.test>",
};
const binding = {
  actorUserId: "actor",
  mailboxId: "inbox",
  sendOperationId: "18cba911-a53c-4555-a8bd-c03394db8335",
};

const quotedMessage = (
  seededBy: "reply" | "reply-all" | "forward" = "reply"
) => {
  const quote = buildComposeMessageQuotes(source);
  return composeMessageEnvelopeSchema.parse({
    attachments: [],
    bodyHtml: `<p>My reply.</p>${seededBy === "forward" ? quote.forwardHtml : quote.replyHtml}`,
    bodyText: `My reply.\n\n${seededBy === "forward" ? quote.forwardText : quote.replyText}`,
    draftAnchor: {
      seededBy,
      sourceMessageId: source.id,
      sourceThreadId: source.threadId,
    },
    inlineImages: [],
    localId: "local-draft",
    recipients: { bcc: "", cc: "", to: "sender@example.test" },
    saveStatus: "idle",
    sendOperationId: binding.sendOperationId,
    subject: "Reply",
    updatedAt: Date.now(),
  });
};

const createProof = (message: ReturnType<typeof quotedMessage>) => {
  const authored = getAuthoredSnippetContent(
    { ...message, bodyHtml: normalizeComposeBodyHtml(message) },
    source
  );
  return composeSnippetQuoteProofSchema.parse({
    ...binding,
    ...authored,
    bodyHash: hashComposeSnippetBody(message),
    source: {
      mailboxId: binding.mailboxId,
      messageId: source.id,
      seededBy: message.draftAnchor?.seededBy,
      threadId: source.threadId,
    },
    version: 1,
  });
};

describe("server-owned snippet quote provenance", () => {
  test.each(["reply", "reply-all", "forward"] as const)(
    "admits only the inherited %s quote with matching private proof",
    (action) => {
      const message = quotedMessage(action);
      const snippetQuote = createProof(message);
      expect(() => {
        assertComposeSnippetFieldsResolved({ ...binding, message });
      }).toThrow(ORPCError);
      expect(() => {
        assertComposeSnippetFieldsResolved({
          ...binding,
          message,
          snippetQuote,
        });
      }).not.toThrow();
      expect(composeMessageInputSchema.safeParse(message).success).toBeFalsy();
    }
  );

  test.each(["actor", "mailbox", "operation", "body", "anchor"] as const)(
    "does not exempt a quote when its %s binding changes",
    (change) => {
      const message = quotedMessage();
      const snippetQuote = createProof(message);
      const input = { ...binding, message, snippetQuote };
      if (change === "actor") {
        input.actorUserId = "another-actor";
      }
      if (change === "mailbox") {
        input.mailboxId = "another-inbox";
      }
      if (change === "operation") {
        input.sendOperationId = crypto.randomUUID();
      }
      if (change === "body") {
        input.message = {
          ...message,
          bodyHtml: `<p>{{?authored}}</p>${message.bodyHtml}`,
        };
      }
      if (change === "anchor") {
        input.message = {
          ...message,
          draftAnchor: {
            seededBy: "forward",
            sourceMessageId: source.id,
            sourceThreadId: source.threadId,
          },
        };
      }
      expect(() => {
        assertComposeSnippetFieldsResolved(input);
      }).toThrow(ORPCError);
    }
  );

  test("normalizes inline images before binding and preserves authored fields in either body alternative", () => {
    const message = quotedMessage();
    message.inlineImages = [
      {
        contentId: "image@example.test",
        id: "image",
        mimeType: "image/png",
        name: "image.png",
        size: 1,
      },
    ];
    message.bodyHtml = `<p><img data-compose-inline-id="image" src="blob:runtime"></p>${message.bodyHtml}`;
    const snippetQuote = createProof(message);
    const normalized = {
      ...message,
      bodyHtml: normalizeComposeBodyHtml(message),
    };
    expect(() => {
      assertComposeSnippetFieldsResolved({
        ...binding,
        message: normalized,
        snippetQuote,
      });
    }).not.toThrow();
    for (const edited of [
      { ...message, bodyHtml: `<p>{{?received}}</p>${message.bodyHtml}` },
      { ...message, bodyText: `{{?plain}}\n${message.bodyText}` },
    ]) {
      const proof = createProof(edited);
      expect(() => {
        assertComposeSnippetFieldsResolved({
          ...binding,
          message: edited,
          snippetQuote: proof,
        });
      }).toThrow(ORPCError);
    }
  });

  test("retains immutable validation proof through capture and internal restoration without rewriting outgoing content", async () => {
    const message = quotedMessage();
    const snippetQuote = createProof(message);
    const payload = await captureScheduledSendPayload(message);
    const storedBinding = {
      ...binding,
      requestHash: hashScheduledSendPayload(payload),
    };
    const serialized = JSON.stringify({
      ...storedBinding,
      formatVersion: 1,
      message: payload,
      origin: { kind: "human" },
      privateContext: false,
      snippetQuote,
    });
    const decoded: unknown = JSON.parse(serialized);
    const stored = readScheduledSendPayload(decoded, storedBinding);
    const restored = restoreScheduledSendPayload(stored.message, {
      localId: "scheduled:attempt",
      sendOperationId: binding.sendOperationId,
    });
    expect(restored.bodyHtml).toContain("{{?received}}");
    expect(restored.bodyText).toContain("{{@context}}");
    expect(() => {
      assertComposeSnippetFieldsResolved({
        ...binding,
        message: restored,
        snippetQuote: stored.snippetQuote,
      });
    }).not.toThrow();
    const invalid = readScheduledSendPayload(
      {
        ...storedBinding,
        formatVersion: 1,
        message: payload,
        origin: { kind: "human" },
        privateContext: false,
        snippetQuote: { ...snippetQuote, version: 99 },
      },
      storedBinding
    );
    expect(() => {
      assertComposeSnippetFieldsResolved({
        ...binding,
        message: restored,
        snippetQuote: invalid.snippetQuote,
      });
    }).toThrow(ORPCError);
  });

  test("the public readiness input accepts metadata but no private proof or file bytes", () => {
    const message = quotedMessage();
    const input = {
      bodyHtml: message.bodyHtml,
      bodyText: message.bodyText,
      draftAnchor: message.draftAnchor,
      inlineImages: message.inlineImages,
      mailboxId: binding.mailboxId,
    };
    expect(
      composeSendReadinessInputSchema.safeParse(input).success
    ).toBeTruthy();
    expect(
      composeSendReadinessInputSchema.safeParse({
        ...input,
        snippetQuote: createProof(message),
      }).success
    ).toBeFalsy();
    expect(
      composeSendReadinessInputSchema.safeParse({
        ...input,
        inlineImages: [
          {
            contentId: "image@example.test",
            file: new File(["bytes"], "image.png"),
            id: "image",
            mimeType: "image/png",
            name: "image.png",
            size: 5,
          },
        ],
      }).success
    ).toBeFalsy();
  });
});
