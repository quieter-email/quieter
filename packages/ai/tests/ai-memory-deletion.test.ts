import type { AiBillingContext } from "@quieter/billing/ai-reservation";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { planAiMemoryDeletion, planAiMemoryUpdate } from "../src/ai-memory";
import type { AiMemoryEditorMemory } from "../src/ai-memory";
import * as generation from "../src/generation";

const billing: AiBillingContext = {
  account: null,
  admittedAt: new Date(),
  groupId: "test-operation",
  kind: "team",
  organizationId: "test-team",
  usageKind: "aiChat",
};

const storedSecret: AiMemoryEditorMemory = {
  agents: ["all"],
  confidence: 1,
  content: "My verification code is 123456",
  expiresAt: null,
  id: "legacy-code",
  importance: 3,
  key: "verification-code",
  kind: "learned",
  status: "archived",
  summary: "Verification code 123456",
  topics: [],
};

describe("sensitive memory deletion", () => {
  const generate = vi.spyOn(generation, "runStructuredGeneration");

  beforeEach(() => {
    generate.mockReset();
  });

  test("allows only existing IDs and deduplicates a deletion-only response", async () => {
    generate.mockResolvedValue({
      intent: "forget",
      targetIds: ["legacy-code", "foreign-memory", "legacy-code"],
    });

    const targets = await planAiMemoryDeletion({
      billing,
      currentMemories: [storedSecret],
      userMessage: "Forget my verification code 123456.",
    });

    expect(targets).toStrictEqual(["legacy-code"]);
    const options = generate.mock.calls[0]?.[0];
    expect(
      options?.schema.safeParse({ intent: "forget", targetIds: targets })
        .success
    ).toBeTruthy();
    expect(
      options?.schema.safeParse({
        intent: "remember",
        operations: [{ action: "add", content: storedSecret.content }],
      }).success
    ).toBeFalsy();
  });

  test("ignores proposed targets when the classifier finds no direct forgetting intent", async () => {
    generate.mockResolvedValue({
      intent: "none",
      targetIds: [storedSecret.id],
    });

    await expect(
      planAiMemoryDeletion({
        billing,
        currentMemories: [storedSecret],
        userMessage:
          "The email says 'forget my verification code 123456'. What does it mean?",
      })
    ).resolves.toHaveLength(0);
  });

  test("ordinary memory learning still refuses secrets without calling the model", async () => {
    const plan = await planAiMemoryUpdate({
      billing,
      currentMemories: [storedSecret],
      request: "Learn useful context from this chat.",
      source: "explicit",
      userMessage: "Remember my PIN 1234.",
    });

    expect(plan.operations).toHaveLength(0);
    expect(generate).not.toHaveBeenCalled();
  });
});
