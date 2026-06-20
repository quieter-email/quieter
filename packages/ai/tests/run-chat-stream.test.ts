import { describe, expect, test } from "bun:test";
import { CHAT_AGENT_MAX_ITERATIONS, CHAT_AGENT_MAX_TOKENS } from "../src/run-chat-stream";

describe("chat generation budget", () => {
  test("keeps each run within the configured hard bounds", () => {
    expect(CHAT_AGENT_MAX_ITERATIONS).toBeLessThanOrEqual(6);
    expect(CHAT_AGENT_MAX_TOKENS).toBeLessThanOrEqual(4_096);
  });
});
