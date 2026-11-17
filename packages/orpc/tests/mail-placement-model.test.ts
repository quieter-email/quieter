import { describe, expect, test } from "vite-plus/test";

import { resolvePlacementTargets } from "../src/mail/placement-model";
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
      resolvePlacementTargets({
        messages,
        placement: "done",
        requestedMessageIds: ["visible-anchor"],
        threadId: "conversation",
      })
    ).toMatchObject({
      intentMessageIds: ["old-incoming", "visible-anchor"],
      messageIds: ["old-incoming", "visible-anchor"],
    });
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
      resolvePlacementTargets({
        messages: handled,
        placement: "inbox",
        requestedMessageIds: ["visible-anchor"],
        threadId: "conversation",
      })
    ).toMatchObject({
      intentMessageIds: ["old-incoming", "visible-anchor"],
      messageIds: ["old-incoming", "visible-anchor"],
    });
  });

  test("rejects missing or cross-conversation anchors before selecting any mail", () => {
    expect(
      resolvePlacementTargets({
        messages,
        placement: "done",
        requestedMessageIds: ["missing"],
        threadId: "conversation",
      })
    ).toBeNull();
    expect(
      resolvePlacementTargets({
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
      resolvePlacementTargets({
        messages: protectedMessages,
        placement: "done",
        requestedMessageIds: ["visible-anchor"],
        threadId: "conversation",
      })
    ).toMatchObject({ intentMessageIds: ["visible-anchor"], messageIds: [] });
  });

  test("fences the complete normal prefix even when only part needs a state change", () => {
    const result = resolvePlacementTargets({
      messages: [
        ...messages,
        {
          id: "already-done",
          placement: "done",
          receivedAt: 0,
          threadId: "conversation",
        },
        {
          id: "another-conversation",
          placement: "done",
          receivedAt: 1,
          threadId: "another",
        },
      ],
      placement: "done",
      requestedMessageIds: ["visible-anchor"],
      threadId: "conversation",
    });
    expect(result?.messageIds).toStrictEqual([
      "old-incoming",
      "visible-anchor",
    ]);
    expect(result?.intentMessageIds).toStrictEqual([
      "already-done",
      "old-incoming",
      "visible-anchor",
    ]);
  });

  test("Return to Inbox keeps newer handled mail outside both effects and intent", () => {
    const result = resolvePlacementTargets({
      messages: messages.map((message): PlacementMessage => ({
        ...message,
        placement: message.placement === "protected" ? "protected" : "done",
      })),
      placement: "inbox",
      requestedMessageIds: ["visible-anchor", "visible-anchor"],
      threadId: "conversation",
    });
    expect(result?.messageIds).toStrictEqual([
      "old-incoming",
      "visible-anchor",
    ]);
    expect(result?.intentMessageIds).toStrictEqual([
      "old-incoming",
      "visible-anchor",
    ]);
  });
});
