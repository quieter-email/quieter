import { convertToModelMessages } from "ai";
import { describe, expect, test } from "vite-plus/test";

import { toCanonicalTranscript } from "../src/chat-transcript";

describe("interrupted chat transcripts", () => {
  test("restores UI status without attributing the status to the assistant", async () => {
    const rows = [
      {
        id: "assistant",
        parts: [
          { text: "I found the first message.", type: "text" },
          {
            data: "The reply was interrupted.",
            type: "data-chat-interruption",
          },
        ],
        role: "assistant" as const,
      },
    ];
    expect(
      toCanonicalTranscript(rows, { includeInterruption: true })[0]?.parts
    ).toContainEqual(
      expect.objectContaining({ type: "data-chat-interruption" })
    );
    const modelMessages = await convertToModelMessages(
      toCanonicalTranscript(rows)
    );
    expect(modelMessages).toMatchObject([
      {
        content: [{ text: "I found the first message.", type: "text" }],
        role: "assistant",
      },
    ]);
    expect(JSON.stringify(modelMessages)).not.toMatch(/interrupted/iu);
  });

  test("retains status-only replies for the UI and drops them from model history", () => {
    const rows = [
      {
        id: "assistant",
        parts: [
          { type: "step-start" },
          {
            data: "The reply was interrupted.",
            type: "data-chat-interruption",
          },
        ],
        role: "assistant" as const,
      },
    ];
    expect(
      toCanonicalTranscript(rows, { includeInterruption: true })
    ).toHaveLength(1);
    expect(toCanonicalTranscript(rows)).toHaveLength(0);
  });
});
