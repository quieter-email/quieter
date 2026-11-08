import { describe, expect, test } from "vite-plus/test";

import {
  containsProhibitedMemorySecret,
  sanitizeAiMemoryUpdatePlan,
} from "../src/ai-memory";

describe("dynamic AI memory", () => {
  test("rejects malformed and expired intentions without making them permanent", () => {
    const operation = {
      action: "add" as const,
      agents: ["all"],
      confidence: 0.8,
      content: "Temporary preference",
      importance: 3,
      kind: "learned" as const,
      summary: "Temporary preference",
      targetId: null,
      topics: ["test"],
    };
    const result = sanitizeAiMemoryUpdatePlan({
      answer: "Done.",
      operations: [
        { ...operation, expiresAt: "2000-01-01T00:00:00.000Z", key: "expired" },
        { ...operation, expiresAt: "2999-01-01T00:00:00.000Z", key: "future" },
        { ...operation, expiresAt: "invalid", key: "malformed" },
        { ...operation, expiresAt: "", key: "empty" },
        { ...operation, expiresAt: null, key: "durable" },
      ],
      summary: "Updated memory.",
    });

    expect(result.operations.map(({ expiresAt }) => expiresAt)).toStrictEqual([
      "2999-01-01T00:00:00.000Z",
      null,
    ]);
  });

  test("allows useful private context while rejecting credentials and payment identifiers", () => {
    expect(
      containsProhibitedMemorySecret(
        "My partner Sam has a chronic illness, so keep medical scheduling replies gentle."
      )
    ).toBeFalsy();
    expect(
      containsProhibitedMemorySecret(
        "My password is correct-horse-battery-staple"
      )
    ).toBeTruthy();
    expect(
      containsProhibitedMemorySecret("Use card 4242 4242 4242 4242")
    ).toBeTruthy();
  });

  test("keeps message identifiers whose numeric fragments resemble a payment number", () => {
    expect(
      containsProhibitedMemorySecret("632ab275-ff86-4734-9284-034d733d6f7e")
    ).toBeFalsy();
    expect(
      containsProhibitedMemorySecret(
        "Message 632ab275-ff86-4734-9284-034d733d6f7e was received."
      )
    ).toBeFalsy();
    expect(containsProhibitedMemorySecret("4242-4242-4242-4242")).toBeTruthy();
    expect(
      containsProhibitedMemorySecret(
        "Message 632ab275-ff86-4734-9284-034d733d6f7e contains card 4242-4242-4242-4242"
      )
    ).toBeTruthy();
  });

  test("does not retain secrets in descriptive fields or change summaries", () => {
    const operation = {
      action: "add" as const,
      agents: ["all"],
      confidence: 0.8,
      content: "A useful fact.",
      expiresAt: null,
      importance: 3,
      key: "work-context",
      kind: "learned" as const,
      summary: "A useful fact.",
      targetId: null,
      topics: [],
    };
    const secret = "My password is correct-horse-battery-staple";
    const result = sanitizeAiMemoryUpdatePlan({
      answer: secret,
      operations: [
        { ...operation, content: secret },
        { ...operation, topics: [secret] },
        { ...operation, key: secret },
        { ...operation, correspondents: [secret] },
      ],
      summary: secret,
    });

    expect(result.operations).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain(
      "correct-horse-battery-staple"
    );
  });

  test.each([
    ["Find the security code email from my bank.", false],
    ["The verification code is sent to my phone.", false],
    ["Your verification code from Google.", false],
    ["My security PIN is 1234", true],
    ["Verification code: 8M2K", true],
    ["The one-time code is AB-72", true],
  ])("classifies code material in %s", (text, prohibited) => {
    expect(containsProhibitedMemorySecret(text)).toBe(prohibited);
  });
});
