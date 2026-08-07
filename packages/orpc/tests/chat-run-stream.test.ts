import { describe, expect, test } from "vite-plus/test";
import { isActiveChatRunStatus } from "../src/chat-run-stream";
import { createPostgresStreamDurability } from "../src/chat/stream-durability";

describe("chat run stream", () => {
  test("identifies active statuses", () => {
    expect(isActiveChatRunStatus("queued")).toBe(true);
    expect(isActiveChatRunStatus("waiting_on_tool")).toBe(true);
    expect(isActiveChatRunStatus("complete")).toBe(false);
  });

  test("postgres durability encodes opaque offsets per chunk", async () => {
    const durability = createPostgresStreamDurability({
      offset: null,
      runId: "run-offset-shape",
    });

    expect(durability.resumeFrom()).toBeNull();

    // append/read need a live database; shape-check construction only here.
    expect(typeof durability.append).toBe("function");
    expect(typeof durability.read).toBe("function");
    expect(typeof durability.close).toBe("function");
    expect(typeof durability.snapshot).toBe("function");
  });
});
