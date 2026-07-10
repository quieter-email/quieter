import { describe, expect, test } from "vite-plus/test";
import {
  buildUserAiContextEditorInput,
  sanitizeUserAiContextMarkdown,
  USER_AI_CONTEXT_MARKDOWN_MAX_LENGTH,
} from "../src/user-ai-context";

describe("user AI context editor", () => {
  test("builds compact event input without expanding metadata", () => {
    const input = buildUserAiContextEditorInput({
      currentMarkdown: "## Preferences\n- Prefer delivery details.",
      events: [
        {
          id: "event-1",
          kind: "useful_detail_feedback",
          metadata: {
            detailKind: "delivery",
            signal: "useful",
            source: "store.example",
          },
        },
      ],
    });

    expect(input.events).toEqual([
      {
        id: "event-1",
        kind: "useful_detail_feedback",
        metadata: {
          detailKind: "delivery",
          signal: "useful",
          source: "store.example",
        },
      },
    ]);
  });

  test("caps generated markdown to the prompt budget", () => {
    const markdown = sanitizeUserAiContextMarkdown(
      "x".repeat(USER_AI_CONTEXT_MARKDOWN_MAX_LENGTH + 10),
    );

    expect(markdown.length).toBeLessThanOrEqual(USER_AI_CONTEXT_MARKDOWN_MAX_LENGTH);
  });
});
