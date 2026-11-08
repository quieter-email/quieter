import type { AiBillingContext } from "@quieter/billing/ai-reservation";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import * as generationModule from "../src/generation";
import { parseMailSearchWithAi } from "../src/parse-mail-search";

const billing: AiBillingContext = {
  account: null,
  admittedAt: new Date(),
  groupId: "test-operation",
  kind: "team",
  organizationId: "test-team",
  usageKind: "aiChat",
};

describe(parseMailSearchWithAi, () => {
  const spy = vi.spyOn(generationModule, "runStructuredGeneration");

  beforeEach(() => {
    spy.mockClear();
    spy.mockResolvedValue({
      filters: [],
      freeText: "",
    });
  });

  test.each([
    { type: "label", value: "Private label not supplied" },
    { type: "is", value: "sent" },
    { type: "has", value: "drive" },
    { type: "after", value: "2026/2/30" },
    { type: "before", value: "2026/13/1" },
    { type: "older_than", value: "0d" },
    { type: "newer_than", value: "1d OR in:anywhere" },
  ] as const)(
    "rejects model filters outside the available search contract (%j)",
    async (filter) => {
      spy.mockResolvedValue({ filters: [filter], freeText: "" });
      await expect(
        parseMailSearchWithAi({
          allowedIsValues: ["read", "unread"],
          availableLabels: ["Finance"],
          billing,
          query: "unread finance messages",
        })
      ).rejects.toThrow(/unsupported/iu);
    }
  );

  test("retains valid supplied labels, supported states, and real date ranges", async () => {
    spy.mockResolvedValue({
      filters: [
        { type: "label", value: "Finance" },
        { type: "is", value: "unread" },
        { type: "after", value: "2024/2/29" },
        { type: "newer_than", value: "7d" },
      ],
      freeText: "renewal",
    });
    const result = await parseMailSearchWithAi({
      allowedIsValues: ["unread"],
      availableLabels: ["Finance"],
      billing,
      query: "unread finance messages about renewal this week",
    });
    expect(result.filters).toContainEqual({ type: "label", value: "Finance" });
    expect(result.filters).toContainEqual({ type: "is", value: "unread" });
    expect(result.freeText).toBe("renewal");
  });
});
