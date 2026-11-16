import { buildComposeDraftFromMessageAction } from "@quieter/app/features/compose/domain/compose-actions";
import {
  composeMessageInputSchema,
  getUnresolvedSnippetFields,
} from "@quieter/mail/compose/schema";
import type { MessageListItem } from "@quieter/mail/messages";
import { createScheduledSendSchema } from "@quieter/mail/scheduled-send";
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

describe("snippet admission for inherited message quotes", () => {
  test.each(["reply", "reply-all", "forward"] as const)(
    "allows a human %s to retain literal received markers",
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

      expect(getUnresolvedSnippetFields(message)).toHaveLength(0);
      expect(composeMessageInputSchema.safeParse(message).success).toBeTruthy();
      expect(
        createScheduledSendSchema.safeParse({
          mailboxId: "mailbox",
          message,
          sendAt: "2027-01-01T09:00:00Z",
          timeZone: "UTC",
        }).success
      ).toBeTruthy();

      expect(
        getUnresolvedSnippetFields({
          ...message,
          bodyHtml: `<p>{{?source}} {{?authored}}</p>${quote.bodyHtml}`,
          bodyText: `{{?source}} {{?authored}}\n\n${quote.bodyText}`,
        })
      ).toContain("authored");
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
});
