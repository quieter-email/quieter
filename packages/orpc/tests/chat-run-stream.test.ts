import { describe, expect, test } from "vite-plus/test";
import { isActiveChatRunStatus } from "../src/chat-run-store";
import {
  decodeChatRunStreamSeq,
  encodeChatRunStreamOffset,
  sanitizeChatRunStreamOffset,
} from "../src/chat/stream-durability";

describe("chat run stream", () => {
  test("identifies active statuses", () => {
    expect(isActiveChatRunStatus("queued")).toBe(true);
    expect(isActiveChatRunStatus("waiting_on_tool")).toBe(true);
    expect(isActiveChatRunStatus("complete")).toBe(false);
  });

  test("postgres durability encodes opaque offsets per chunk", () => {
    expect(encodeChatRunStreamOffset("run-a", 1)).toBe("run-a:1");
    expect(decodeChatRunStreamSeq("run-a", "run-a:1")).toBe(1);
    expect(decodeChatRunStreamSeq("run-a", "run-a:12")).toBe(12);
    expect(decodeChatRunStreamSeq("run-a", "-1")).toBe(0);
    expect(decodeChatRunStreamSeq("run-a", "run-b:1")).toBeNull();
    expect(decodeChatRunStreamSeq("run-a", "run-a:0")).toBeNull();
    expect(decodeChatRunStreamSeq("run-a", "run-a:-1")).toBeNull();
    expect(decodeChatRunStreamSeq("run-a", "not-an-offset")).toBeNull();
    expect(sanitizeChatRunStreamOffset("run-a", "run-b:1")).toBe("-1");
    expect(sanitizeChatRunStreamOffset("run-a", "run-a:3")).toBe("run-a:3");
  });
});
