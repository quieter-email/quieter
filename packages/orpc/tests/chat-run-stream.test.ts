import { describe, expect, test } from "bun:test";
import {
  isActiveChatRunStatus,
  publishChatRunEvent,
  subscribeChatRunEvents,
  type ChatRunStreamEvent,
} from "../src/chat-run-stream";

describe("chat run stream", () => {
  test("publishes events to every active subscriber", () => {
    const first: ChatRunStreamEvent[] = [];
    const second: ChatRunStreamEvent[] = [];
    const unsubscribeFirst = subscribeChatRunEvents("run-1", (event) => first.push(event));
    const unsubscribeSecond = subscribeChatRunEvents("run-1", (event) => second.push(event));
    const event: ChatRunStreamEvent = {
      assistantMessageId: "message-1",
      parts: [{ content: "Hello", type: "text" }],
      type: "draft",
    };

    publishChatRunEvent("run-1", event);
    unsubscribeFirst();
    publishChatRunEvent("run-1", { status: "running", type: "status" });
    unsubscribeSecond();

    expect(first).toEqual([event]);
    expect(second).toEqual([event, { status: "running", type: "status" }]);
  });

  test("identifies active statuses", () => {
    expect(isActiveChatRunStatus("queued")).toBe(true);
    expect(isActiveChatRunStatus("waiting_on_tool")).toBe(true);
    expect(isActiveChatRunStatus("complete")).toBe(false);
  });
});
