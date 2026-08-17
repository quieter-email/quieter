import type { MessagePart } from "@tanstack/ai";
import { describe, expect, test } from "vite-plus/test";

import { getActiveToolCallId } from "./assistant-content";

const toolCall = (id: string): MessagePart => ({
  arguments: "{}",
  id,
  name: "search_gmail",
  state: "input-complete",
  type: "tool-call",
});

const toolResult = (toolCallId: string): MessagePart => ({
  content: "{}",
  state: "complete",
  toolCallId,
  type: "tool-result",
});

const text = (content: string): MessagePart => ({ content, type: "text" });

describe("active tool step", () => {
  test("is the call still waiting on a result", () => {
    expect(getActiveToolCallId([text("Looking."), toolCall("a")])).toBe("a");
  });

  test("stays on the newest finished step while the model works", () => {
    expect(
      getActiveToolCallId([toolCall("a"), toolResult("a"), toolCall("b")])
    ).toBe("b");
  });

  test("clears once the model writes an answer", () => {
    expect(
      getActiveToolCallId([toolCall("a"), toolResult("a"), text("Found two.")])
    ).toBeNull();
  });

  test("ignores empty trailing text so a step stays open mid-stream", () => {
    expect(
      getActiveToolCallId([toolCall("a"), toolResult("a"), text("")])
    ).toBe("a");
  });

  test("is nothing when the message has no steps", () => {
    expect(getActiveToolCallId([text("Hello.")])).toBeNull();
  });
});
