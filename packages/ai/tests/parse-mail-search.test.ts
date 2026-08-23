import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";

import * as generationModule from "../src/generation";
import {
  parseMailSearchWithAi,
  parsedMailSearchSchema,
} from "../src/parse-mail-search";

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
      query: "sent newsletters",
    });

    const options = spy.mock.calls[0][0] as { prompt: string; system: string };
    expect(options.system).toContain(
      "is with exactly one value of: archived, read, unread."
    );
    expect(options.system).not.toContain("inbox");
  });

  test("uses the full default list without restrictions", async () => {
    await parseMailSearchWithAi({
      availableLabels: ["Work Projects"],
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
      query: "last week",
    });

    const options = spy.mock.calls[0][0] as { prompt: string; system: string };
    const prompt = promptSchema.parse(JSON.parse(options.prompt));
    expect(options.system).toContain(`${prompt.today};`);
    expect(/^\d{4}\/\d{1,2}\/\d{1,2}$/u.test(prompt.today)).toBeTruthy();
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
});
