import type { ChatMessagePart } from "@quieter/database/schema";
import { describe, expect, test } from "vite-plus/test";

import {
  cancelForegroundExchangeParts,
  interruptedChatParts,
  mergePendingChatResolutions,
} from "../src/chat/continuation";
import { hasPrivateChatContext } from "../src/chat/private-context";

const publicMarker = { type: "data-ai-private-context", used: false };
const privateMarker = { type: "data-ai-private-context", used: true };
const pending = {
  input: {},
  state: "input-available",
  toolCallId: "workspace",
  type: "tool-get_workspace",
};

describe("trusted chat privacy provenance", () => {
  test.each([
    { parts: [{ text: "Historical assistant text", type: "text" }] },
    { parts: [{ type: "data-ai-private-context", used: "false" }] },
    { parts: [publicMarker, publicMarker] },
  ])(
    "unknown or malformed stored provenance cannot permit a shared AI write %#",
    ({ parts }) => {
      expect(hasPrivateChatContext(parts)).toBeTruthy();
    }
  );

  test("a fresh public-only exchange stays public through continuation and interruption", () => {
    const resolved = mergePendingChatResolutions({
      persistedParts: [publicMarker, pending],
      resolvedParts: [
        privateMarker,
        {
          ...pending,
          output: { mailboxId: "shared-inbox" },
          state: "output-available",
        },
      ],
    });
    expect(hasPrivateChatContext(resolved)).toBeFalsy();
    expect(
      resolved.find((part) => part.toolCallId === "workspace")?.state
    ).toBe("output-available");
    const interrupted = interruptedChatParts({
      errorText: "Interrupted.",
      persistedParts: resolved,
      retryable: true,
      streamedParts: [
        privateMarker,
        { text: "Only shared inbox facts.", type: "text" },
      ],
    });
    expect(hasPrivateChatContext(interrupted)).toBeFalsy();
  });

  test("an upgraded private marker survives older client resolutions and a later public read", () => {
    const receipt = {
      output: { id: "accepted" },
      state: "output-available",
      toolCallId: "send",
      type: "tool-send_mail",
    };
    const current: ChatMessagePart[] = [privateMarker, receipt, pending];
    const resolved = mergePendingChatResolutions({
      persistedParts: current,
      resolvedParts: [
        publicMarker,
        { ...receipt, output: { id: "forged" } },
        {
          ...pending,
          output: { mailboxId: "shared-inbox" },
          state: "output-available",
        },
      ],
    });
    expect(hasPrivateChatContext(resolved)).toBeTruthy();
    expect(
      resolved.find((part) => part.toolCallId === "send")?.output
    ).toMatchObject({ id: "accepted" });
    const interrupted = interruptedChatParts({
      errorText: "Interrupted.",
      persistedParts: resolved,
      retryable: true,
      streamedParts: [
        publicMarker,
        {
          output: { status: "success" },
          state: "output-available",
          toolCallId: "search",
          type: "tool-search_mail",
        },
      ],
    });
    expect(hasPrivateChatContext(interrupted)).toBeTruthy();
  });

  test("a committed cancellation cannot be removed by older pending resolutions", () => {
    const canceled = cancelForegroundExchangeParts([privateMarker, pending]);
    const merged = mergePendingChatResolutions({
      persistedParts: canceled,
      resolvedParts: [
        publicMarker,
        {
          ...pending,
          output: { mailboxId: "shared-inbox" },
          state: "output-available",
        },
      ],
    });
    expect(
      merged.some((part) => part.type === "data-foreground-cancelled")
    ).toBeTruthy();
    expect(merged.find((part) => part.toolCallId === "workspace")?.state).toBe(
      "output-error"
    );
    expect(hasPrivateChatContext(merged)).toBeTruthy();
  });
});
