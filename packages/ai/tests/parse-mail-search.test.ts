import { describe, expect, test } from "vite-plus/test";

import { parsedMailSearchSchema } from "../src/parse-mail-search";

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
