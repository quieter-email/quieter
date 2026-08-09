import { describe, expect, test } from "vite-plus/test";

import type { MessageListItem } from "./gmail";
import { buildThreadListEntries, getThreadLabelIds } from "./thread-list";

const message = (id: string, labelIds: string[]): MessageListItem => ({
  from: "Alex <alex@example.com>",
  id,
  internalDate: id === "latest" ? "2000" : "1000",
  labelIds,
  subject: "A conversation",
  threadId: "thread-1",
});

describe("thread label aggregation", () => {
  test("combines labels from every message in a thread", () => {
    const entries = buildThreadListEntries([
      message("latest", ["INBOX", "latest-only"]),
      message("previous", ["INBOX", "previous-only"]),
    ]);

    expect(entries[0]?.threadLabelIds).toStrictEqual([
      "INBOX",
      "latest-only",
      "previous-only",
    ]);
  });

  test("prefers the server-provided thread label snapshot for an anchor message", () => {
    expect(
      getThreadLabelIds([
        {
          labelIds: ["latest-only"],
          threadLabelIds: ["latest-only", "previous-only"],
        },
      ])
    ).toStrictEqual(["latest-only", "previous-only"]);
  });
});
