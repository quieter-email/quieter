import { describe, expect, test } from "vite-plus/test";

import { validateDailyBriefSources } from "../src/daily-brief";

const candidate = {
  bodyText: "Please review the proposal by tomorrow.",
  fromName: "Alex",
  messageId: "message-a",
  receivedAt: "2026-10-15T08:00:00Z",
  subject: "Proposal",
  threadId: "thread-a",
  unread: true,
};
const item = {
  group: "To review",
  priority: 80,
  reason: "A review is requested by tomorrow.",
  sourceMessageIds: [candidate.messageId],
  summary: "Alex requests a review of the proposal.",
  title: "Review the proposal",
  urgent: false,
};

describe("Daily Brief source isolation", () => {
  test("rejects invented citations and citations from another mailbox", () => {
    expect(() =>
      validateDailyBriefSources(
        { items: [{ ...item, sourceMessageIds: ["other-mailbox-message"] }] },
        [candidate]
      )
    ).toThrow(/source/u);
  });

  test("rejects repeated citations within and across items", () => {
    expect(() =>
      validateDailyBriefSources(
        {
          items: [
            {
              ...item,
              sourceMessageIds: [candidate.messageId, candidate.messageId],
            },
          ],
        },
        [candidate]
      )
    ).toThrow(/repeated/u);
    expect(() =>
      validateDailyBriefSources({ items: [item, item] }, [candidate])
    ).toThrow(/repeated/u);
  });

  test("maps citation metadata from the selected source", () => {
    const result = validateDailyBriefSources({ items: [item] }, [candidate]);
    expect(result[0]?.sources).toContainEqual({
      fromName: "Alex",
      messageId: "message-a",
      subject: "Proposal",
      threadId: "thread-a",
    });
    expect(result[0]).not.toHaveProperty("sourceMessageIds");
  });
});
