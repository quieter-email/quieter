import { describe, expect, test } from "vite-plus/test";

import { resolvePlacementMessageIds } from "../src/mail/placement-model";
import type { PlacementMessage } from "../src/mail/placement-model";

const messages: PlacementMessage[] = [
  {
    id: "old-incoming",
    placement: "inbox",
    receivedAt: 1,
    threadId: "conversation",
  },
  {
    id: "sent-reply",
    placement: "protected",
    receivedAt: 2,
    threadId: "conversation",
  },
  {
    id: "visible-anchor",
    placement: "inbox",
    receivedAt: 3,
    threadId: "conversation",
  },
  {
    id: "new-reply",
    placement: "inbox",
    receivedAt: 4,
    threadId: "conversation",
  },
];

describe("conversation placement snapshots", () => {
  test("handles older incoming messages through the known anchor while preserving sent history and unseen replies", () => {
    expect(
      resolvePlacementMessageIds({
        messages,
        placement: "done",
        requestedMessageIds: ["visible-anchor"],
        threadId: "conversation",
      })
    ).toMatchObject(["old-incoming", "visible-anchor"]);
  });

  test("restores only handled incoming history without rescuing protected or newer messages", () => {
    const handled = messages.map((message): PlacementMessage => ({
      ...message,
      placement:
        message.id === "old-incoming" || message.id === "visible-anchor"
          ? "done"
          : message.placement,
    }));
    expect(
      resolvePlacementMessageIds({
        messages: handled,
        placement: "inbox",
        requestedMessageIds: ["visible-anchor"],
        threadId: "conversation",
      })
    ).toMatchObject(["old-incoming", "visible-anchor"]);
  });

  test("rejects missing or cross-conversation anchors before selecting any mail", () => {
    expect(
      resolvePlacementMessageIds({
        messages,
        placement: "done",
        requestedMessageIds: ["missing"],
        threadId: "conversation",
      })
    ).toBeNull();
    expect(
      resolvePlacementMessageIds({
        messages,
        placement: "done",
        requestedMessageIds: ["visible-anchor"],
        threadId: "different-conversation",
      })
    ).toBeNull();
  });

  test("preserves spam and trash and treats already handled mail as an idempotent no-op", () => {
    const protectedMessages = messages.map((message): PlacementMessage => ({
      ...message,
      placement: message.id === "visible-anchor" ? "done" : "protected",
    }));
    expect(
      resolvePlacementMessageIds({
        messages: protectedMessages,
        placement: "done",
        requestedMessageIds: ["visible-anchor"],
        threadId: "conversation",
      })
    ).toHaveLength(0);
  });
});
