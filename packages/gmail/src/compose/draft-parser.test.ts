import { describe, expect, test } from "vite-plus/test";

import { parseDraftMessage } from "./draft-parser";

describe(parseDraftMessage, () => {
  test.each([
    {
      expected: ["<root@example.com>", "<parent@example.com>"],
      references:
        "<root@example.com>\r\n\t<parent@example.com> <root@example.com>",
    },
    { expected: [], references: "<".repeat(60_000) },
    { expected: [], references: "<x>".repeat(10_000) },
  ])(
    "restores a bounded, deduplicated References chain",
    ({ references, expected }) => {
      const draft = parseDraftMessage({
        id: "draft",
        message: {
          id: "message",
          payload: {
            headers: [
              { name: "In-Reply-To", value: "<parent@example.com>" },
              { name: "References", value: references },
            ],
          },
          threadId: "thread",
        },
      });
      expect(draft.replyContext?.references).toStrictEqual(expected);
      expect(draft.replyContext?.messageHeaderId).toBe("<parent@example.com>");
    }
  );
});
