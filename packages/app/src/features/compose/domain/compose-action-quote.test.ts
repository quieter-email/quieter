// @vitest-environment jsdom
import { getUnresolvedSnippetFields } from "@quieter/mail/compose/schema";
import { getAuthoredSnippetContent } from "@quieter/mail/compose/snippet-quotes";
import { getSchema } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { describe, expect, test } from "vite-plus/test";

import { getComposeTextFromHtml } from "./compose-action-quote";
import { buildComposeDraftFromMessageAction } from "./compose-actions";

describe("compose action text", () => {
  test("action-switch text keeps inherited quote line breaks and authored warnings", () => {
    const schema = getSchema([StarterKit]);
    const source = {
      bodyHtml: "<p>Received<br>{{?source}}</p>",
      bodyText: "Received\n{{?source}}",
      from: "Sender <sender@example.test>",
      id: "source-message",
      subject: "Received subject",
      threadId: "source-thread",
      to: "reader@example.test",
    };
    for (const action of ["reply", "reply-all", "forward"] as const) {
      const draft = buildComposeDraftFromMessageAction({
        action,
        currentUserEmail: "reader@example.test",
        message: source,
      });
      const bodyText = getComposeTextFromHtml(draft.bodyHtml, schema);
      expect(bodyText).toContain("Received\n{{?source}}");
      const inherited = getAuthoredSnippetContent(
        { ...draft, bodyText },
        source
      );
      expect(
        getUnresolvedSnippetFields({
          bodyHtml: inherited.authoredBodyHtml,
          bodyText: inherited.authoredBodyText,
        })
      ).toHaveLength(0);
      const bodyHtml = `<p>{{?authored}}</p>${draft.bodyHtml}`;
      const authored = getAuthoredSnippetContent(
        {
          ...draft,
          bodyHtml,
          bodyText: getComposeTextFromHtml(bodyHtml, schema),
        },
        source
      );
      expect(
        getUnresolvedSnippetFields({
          bodyHtml: authored.authoredBodyHtml,
          bodyText: authored.authoredBodyText,
        })
      ).toContain("authored");
    }
  });
});
