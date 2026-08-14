import { describe, expect, test } from "vite-plus/test";

import { readSseEvents } from "./chat-run-stream";

describe(readSseEvents, () => {
  test("consumes many sequential chunks without recursive stack growth", async () => {
    const encoder = new TextEncoder();
    const chunkCount = 12_000;
    let emitted = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted >= chunkCount) {
          controller.close();
          return;
        }
        controller.enqueue(
          encoder.encode(`data: {"type":"text-delta","delta":"x"}\n`)
        );
        emitted += 1;
      },
    });

    let received = 0;
    for await (const _event of readSseEvents(body)) {
      received += 1;
    }

    expect(received).toBe(chunkCount);
  });
});
