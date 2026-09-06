import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { readFeedbackBridgeBody } from "../src/feedback-bridge.ts";

describe("feedback body limits", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("measures UTF-8 bytes rather than character count", async () => {
    await expect(
      readFeedbackBridgeBody(new Response("é").body, 2)
    ).resolves.toBe("é");
    await expect(
      readFeedbackBridgeBody(new Response("é").body, 1)
    ).rejects.toThrow("exceeds its limit");
  });

  it("ends stalled streams at the total deadline", async () => {
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
      },
    });
    await Promise.all([
      expect(readFeedbackBridgeBody(body, 1024)).rejects.toThrow(
        "deadline exceeded"
      ),
      vi.advanceTimersByTimeAsync(10_000),
    ]);
  });
});
