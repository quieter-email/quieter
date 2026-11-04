import type { AiBillingContext } from "@quieter/billing/ai-reservation";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";

import * as generationModule from "../src/generation";
import {
  parseMailSearchWithAi,
  parsedMailSearchSchema,
} from "../src/parse-mail-search";

const billing: AiBillingContext = {
  account: null,
  admittedAt: new Date(),
  groupId: "test-operation",
  kind: "team",
  organizationId: "test-team",
  usageKind: "aiChat",
};

const promptSchema = z.object({
  availableLabels: z.array(z.string()),
  query: z.string(),
  today: z.string(),
});

describe(parseMailSearchWithAi, () => {
  const spy = vi.spyOn(generationModule, "runStructuredGeneration");

  beforeEach(() => {
    spy.mockClear();
    spy.mockResolvedValue({
      filters: [],
      freeText: "",
    });
  });

  test("passes restricted is values into the system prompt", async () => {
    await parseMailSearchWithAi({
      allowedIsValues: ["archived", "read", "unread"],
      availableLabels: [],
      billing,
      query: "sent newsletters",
    });

    const options = spy.mock.calls[0][0] as { prompt: string; system: string };
    for (const value of ["archived", "read", "unread"]) {
      expect(options.system).toContain(value);
    }
    expect(options.system).not.toContain("inbox");
  });

  test("uses the full default list without restrictions", async () => {
    await parseMailSearchWithAi({
      availableLabels: ["Work Projects"],
      billing,
      query: "work stuff",
    });

    const options = spy.mock.calls[0][0] as { prompt: string; system: string };
    expect(options.system).toContain("inbox");
    expect(options.system).toContain("outbound");
    const prompt = promptSchema.parse(JSON.parse(options.prompt));
    expect(prompt.availableLabels).toStrictEqual(["Work Projects"]);
    expect(prompt.query).toBe("work stuff");
  });

  test("anchors prompt and system prompt to the same today value", async () => {
    await parseMailSearchWithAi({
      availableLabels: [],
      billing,
      query: "last week",
    });

    const options = spy.mock.calls[0][0] as { prompt: string; system: string };
    const prompt = promptSchema.parse(JSON.parse(options.prompt));
    expect(options.system).toContain(`${prompt.today};`);
    expect(/^\d{4}\/\d{1,2}\/\d{1,2}$/u.test(prompt.today)).toBeTruthy();
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

describe("parsed mail search schema", () => {
  test("accepts cc and bcc filters", () => {
    const result = parsedMailSearchSchema.safeParse({
      filters: [
        { type: "cc", value: "alice@example.com" },
        { negated: true, type: "bcc", value: "bob" },
      ],
      freeText: "",
    });

    expect(result.success).toBeTruthy();
  });

  test("rejects unknown filter types", () => {
    const result = parsedMailSearchSchema.safeParse({
      filters: [{ type: "folder", value: "inbox" }],
      freeText: "",
    });

    expect(result.success).toBeFalsy();
  });

  test.each(["", "   "])("rejects an empty filter value", (value) => {
    const result = parsedMailSearchSchema.safeParse({
      filters: [{ type: "from", value }],
      freeText: "",
    });

    expect(result.success).toBeFalsy();
  });
});
