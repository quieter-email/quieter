import { buildComposeDraftFromMessageAction } from "@quieter/app/features/compose/domain/compose-actions";
import { buildMimeMessage } from "@quieter/mail/compose/mime";
import {
  composeMessageEnvelopeSchema,
  composeMessageInputSchema,
  getUnresolvedSnippetFields,
} from "@quieter/mail/compose/schema";
import { getAuthoredSnippetContent } from "@quieter/mail/compose/snippet-quotes";
import type { MessageListItem } from "@quieter/mail/messages";
import { parseRawMailMessage } from "@quieter/mail/raw-message";
import { createScheduledSendSchema } from "@quieter/mail/scheduled-send";
import { formatMessageDate } from "@quieter/mail/thread-list";
import { describe, expect, test } from "vite-plus/test";

const received: MessageListItem = {
  bodyHtml: "<p>Received {{?source}}</p>",
  bodyText: "Received {{?source}}",
  from: "Sender <sender@example.test>",
  id: "received-message",
  internalDate: "1794787200000",
  messageHeaderId: "<received@example.test>",
  subject: "A received message",
  threadId: "received-thread",
  to: "Reader <reader@example.test>",
};

const prepareMessage = (
  action: Parameters<typeof buildComposeDraftFromMessageAction>[0]["action"],
  source = received
) => {
  const quote = buildComposeDraftFromMessageAction({
    action,
    currentUserEmail: "reader@example.test",
    message: source,
  });
  if (quote.draftAnchor === null || quote.draftAnchor === undefined) {
    throw new Error("A message action must identify its source.");
  }
  return {
    ...quote,
    bodyHtml: `<p>My response.</p>${quote.bodyHtml}`,
    bodyText: `My response.\n\n${quote.bodyText}`,
    draftAnchor: quote.draftAnchor,
    recipients: { bcc: "", cc: "", to: "sender@example.test" },
  };
};

const getValidationInput = (
  message: Parameters<typeof getAuthoredSnippetContent>[0],
  source: Parameters<typeof getAuthoredSnippetContent>[1]
) => {
  const { authoredBodyHtml, authoredBodyText } = getAuthoredSnippetContent(
    message,
    source
  );
  return { bodyHtml: authoredBodyHtml, bodyText: authoredBodyText };
};

describe("snippet admission for inherited message quotes", () => {
  test.each(["reply", "reply-all", "forward"] as const)(
    "extracts proven inherited content for contextual %s admission",
    (action) => {
      const quote = buildComposeDraftFromMessageAction({
        action,
        currentUserEmail: "reader@example.test",
        message: received,
      });
      const message = {
        ...quote,
        bodyHtml: `<p>My response.</p>${quote.bodyHtml}`,
        bodyText: `My response.\n\n${quote.bodyText}`,
        recipients: { bcc: "", cc: "", to: "sender@example.test" },
      };

      const authored = getValidationInput(message, received);
      expect(getUnresolvedSnippetFields(authored)).toHaveLength(0);
      expect(
        composeMessageInputSchema.safeParse({ ...message, ...authored }).success
      ).toBeTruthy();
      expect(
        createScheduledSendSchema.safeParse({
          mailboxId: "mailbox",
          message: { ...message, ...authored },
          sendAt: "2027-01-01T09:00:00Z",
          timeZone: "UTC",
        }).success
      ).toBeTruthy();

      expect(
        getUnresolvedSnippetFields(
          getValidationInput(
            {
              ...message,
              bodyHtml: `<p>{{?source}} {{?authored}}</p>${quote.bodyHtml}`,
              bodyText: `{{?source}} {{?authored}}\n\n${quote.bodyText}`,
            },
            received
          )
        )
      ).toStrictEqual(["source", "authored"]);
      expect(getUnresolvedSnippetFields(message)).toContain("source");
    }
  );

  test("keeps an ordinary reply and real authored warning observable", () => {
    const quote = buildComposeDraftFromMessageAction({
      action: "reply",
      currentUserEmail: "reader@example.test",
      message: {
        ...received,
        bodyHtml: "<p>Ordinary mail</p>",
        bodyText: "Ordinary mail",
      },
    });
    expect(getUnresolvedSnippetFields(quote)).toHaveLength(0);
    expect(
      composeMessageInputSchema.safeParse({
        ...quote,
        bodyHtml: `<p>{{?authored}}</p>${quote.bodyHtml}`,
        bodyText: `{{?authored}}\n${quote.bodyText}`,
      }).success
    ).toBeFalsy();
  });

  test("keeps modified quotes and new fields inside quotes under ordinary validation", () => {
    const message = prepareMessage("reply");
    for (const bodyHtml of [
      message.bodyHtml.replace("Received", "Edited"),
      message.bodyHtml.replace("Received", "Received {{?authored}}"),
      message.bodyHtml.replace("Received", "Received {{?source}}"),
    ]) {
      const authored = getValidationInput({ ...message, bodyHtml }, received);
      expect(getUnresolvedSnippetFields(authored)).toContain("source");
    }
  });

  test("requires matching source identity and the complete source quote", () => {
    const message = prepareMessage("reply");
    for (const input of [
      { ...message, draftAnchor: null },
      {
        ...message,
        draftAnchor: { ...message.draftAnchor, sourceMessageId: "different" },
      },
      {
        ...message,
        bodyHtml:
          '<p>My response.</p><blockquote data-compose-quote="body">{{?source}}</blockquote>',
        bodyText: "My response.\n{{?source}}",
      },
    ]) {
      expect(
        getUnresolvedSnippetFields(getValidationInput(input, received))
      ).toContain("source");
    }
    expect(
      getUnresolvedSnippetFields(
        getValidationInput(message, {
          ...received,
          threadId: "other-thread",
        })
      )
    ).toContain("source");
  });

  test("keeps mismatched plain alternatives and signatures under validation", () => {
    const message = prepareMessage("reply");
    expect(
      getUnresolvedSnippetFields(
        getValidationInput(
          {
            ...message,
            bodyText: `{{?plainOnly}}\n${message.bodyText}`,
          },
          received
        )
      )
    ).toContain("plainOnly");
    expect(
      getUnresolvedSnippetFields(
        getValidationInput(
          {
            ...message,
            bodyHtml: `<div data-quieter-signature="true">{{?signature}}</div>${message.bodyHtml}`,
            bodyText: `{{?signature}}\n${message.bodyText}`,
          },
          received
        )
      )
    ).toContain("signature");
  });

  test("preserves independently inherited HTML and plain alternatives", () => {
    const source = {
      ...received,
      bodyHtml: "<p>HTML {{?htmlSource}}</p>",
      bodyText: "Plain {{?plainSource}}",
    };
    const message = prepareMessage("reply", source);
    expect(
      getUnresolvedSnippetFields(getValidationInput(message, source))
    ).toHaveLength(0);
    expect(message.bodyHtml).toContain("{{?htmlSource}}");
    expect(message.bodyText).toContain("{{?plainSource}}");
  });

  test("matches unchanged decoded quote text after editor formatting normalization", () => {
    const source = {
      ...received,
      bodyHtml: "<p>Received &#123;&#123;?<strong>source</strong>}}</p>",
    };
    const message = prepareMessage("reply", source);
    const normalized = {
      ...message,
      bodyHtml: message.bodyHtml.replace(
        "&#123;&#123;?<strong>source</strong>}}",
        "{{?<b>source</b>}}"
      ),
    };
    expect(
      getUnresolvedSnippetFields(getValidationInput(normalized, source))
    ).toHaveLength(0);
  });

  test("retains copied sender and subject markers while rejecting new header fields", () => {
    const source = {
      ...received,
      from: '"{{?sender}}" <sender@example.test>',
      subject: "Topic {{?subject}}",
    };
    const message = prepareMessage("forward", source);
    expect(
      getUnresolvedSnippetFields(getValidationInput(message, source))
    ).toHaveLength(0);
    expect(
      getUnresolvedSnippetFields(
        getValidationInput(
          {
            ...message,
            bodyHtml: message.bodyHtml.replace("Topic", "{{?newHeader}} Topic"),
          },
          source
        )
      )
    ).toContain("newHeader");
  });

  test("keeps ambiguous duplicate quote groups under full validation", () => {
    const message = prepareMessage("reply");
    expect(
      getUnresolvedSnippetFields(
        getValidationInput(
          {
            ...message,
            bodyHtml: message.bodyHtml + message.bodyHtml,
            bodyText: message.bodyText + message.bodyText,
          },
          received
        )
      )
    ).toContain("source");
  });

  test.each(["reply", "forward"] as const)(
    "keeps localized %s dates separate from authored fields",
    (action) => {
      const message = prepareMessage(action);
      const date = formatMessageDate(received, "full");
      const localized = new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "Europe/Paris",
      }).format(new Date(Number(received.internalDate)));
      const translated = {
        ...message,
        bodyHtml: message.bodyHtml.replace(date, localized),
        bodyText: message.bodyText.replace(date, localized),
      };
      expect(
        getUnresolvedSnippetFields(getValidationInput(translated, received))
      ).toHaveLength(0);
      expect(
        getUnresolvedSnippetFields(
          getValidationInput(
            {
              ...message,
              bodyHtml: message.bodyHtml.replace(date, "{{?newDateField}}"),
              bodyText: message.bodyText.replace(date, "{{?newDateField}}"),
            },
            received
          )
        )
      ).toContain("newDateField");
    }
  );

  test("preserves literal quote text through a MIME round trip", async () => {
    const message = prepareMessage("forward");
    const parsed = await parseRawMailMessage(
      await buildMimeMessage(composeMessageEnvelopeSchema.parse(message), {
        from: "reader@example.test",
      })
    );
    expect(parsed.bodyText).toContain("Received {{?source}}");
    expect(parsed.bodyHtml).toContain("Received {{?source}}");
    expect(
      getUnresolvedSnippetFields(
        getValidationInput(
          {
            ...message,
            bodyHtml: parsed.bodyHtml ?? "",
            bodyText: parsed.bodyText ?? "",
          },
          received
        )
      )
    ).toHaveLength(0);
  });

  test("retains authored fields in deeply nested markup beside a proven quote", () => {
    const message = prepareMessage("reply");
    expect(
      getUnresolvedSnippetFields(
        getValidationInput(
          {
            ...message,
            bodyHtml: `${"<div>".repeat(8000)}{{?deepAuthored}}${"</div>".repeat(8000)}${message.bodyHtml}`,
            bodyText: `{{?deepAuthored}}\n${message.bodyText}`,
          },
          received
        )
      )
    ).toContain("deepAuthored");
  });
});
