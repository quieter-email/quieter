import { describe, expect, test } from "vite-plus/test";

import { findInvalidMailAddresses } from "../src/compose/schema";
import { decodeMimeHeaderValue, decodePartBody } from "../src/message-content";

describe("message integrity", () => {
  test("preserves unrelated Unicode when a message resembles mojibake", () => {
    const text = "Ã© 漢字";
    expect(decodeMimeHeaderValue(text)).toBe(text);
    expect(
      decodePartBody({
        body: { data: Buffer.from(text).toString("base64url") },
      })
    ).toBe(text);
  });

  test.each([
    "alice@example.com bob@example.com",
    "alice@example.com garbage",
    "Alice <alice@example.com> garbage",
  ])("rejects unparsed recipient text: %s", (entry) => {
    expect(findInvalidMailAddresses(entry)).toStrictEqual([entry]);
  });
});
