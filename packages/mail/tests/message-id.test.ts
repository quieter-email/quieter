import { describe, expect, test } from "vite-plus/test";

import { extractMessageIds, getReplyReferenceIds } from "../src/message-id";
import { parseRawMailMessage } from "../src/raw-message";

describe(extractMessageIds, () => {
  test("ignores malformed delimiters without interpreting nested IDs", () => {
    expect(extractMessageIds("<".repeat(60_000))).toStrictEqual([]);
    expect(
      extractMessageIds(`${"<".repeat(60_000)}> <valid@example.com>`)
    ).toStrictEqual(["<valid@example.com>"]);
    expect(
      extractMessageIds(
        "<> <<nested@example.com>> <valid@example.com> <unfinished"
      )
    ).toStrictEqual(["<valid@example.com>"]);
  });

  test("ignores an excessive field as a whole instead of truncating its chain", () => {
    expect(
      extractMessageIds(`<root@example.com>${" ".repeat(100_000)}`)
    ).toStrictEqual([]);
    expect(extractMessageIds("<x>".repeat(10_000))).toStrictEqual([]);
    expect(
      getReplyReferenceIds({
        inReplyTo: "<parent@example.com>",
        references: "<x>".repeat(10_000),
      })
    ).toStrictEqual(["<parent@example.com>"]);
    expect(
      getReplyReferenceIds({ inReplyTo: "<".repeat(100_000) })
    ).toStrictEqual([]);
  });

  test.each([
    "<root@example.com>\r\n\t<parent@example.com>",
    "=?UTF-8?Q?=3Croot=40example.com=3E_=3Cparent=40example.com=3E?=",
  ])(
    "uses the decoded MIME representation for threading",
    async (references) => {
      const parsed = await parseRawMailMessage(
        [
          "From: sender@example.com",
          "In-Reply-To: =?UTF-8?Q?=3Cparent=40example.com=3E?=",
          `References: ${references}`,
          "Content-Type: text/plain",
          "",
          "Preserved body",
        ].join("\r\n")
      );
      expect(getReplyReferenceIds(parsed)).toStrictEqual([
        "<parent@example.com>",
        "<root@example.com>",
      ]);
      expect(parsed.bodyText).toBe("Preserved body");
      expect(
        parsed.headers.find((header) => header.name === "References")?.value
      ).toBeTruthy();
    }
  );

  test("does not change stored metadata when decoded threading fields are unsafe", async () => {
    const references = "<".repeat(70_000);
    const parsed = await parseRawMailMessage(
      [
        "From: sender@example.com",
        `References: =?UTF-8?B?${Buffer.from(references).toString("base64")}?=`,
        "Content-Type: text/plain",
        "",
        "Preserved body",
      ].join("\r\n")
    );
    expect(getReplyReferenceIds(parsed)).toStrictEqual([]);
    expect(parsed.references).toBe(references);
    expect(parsed.bodyText).toBe("Preserved body");
    expect(
      parsed.headers.find((header) => header.name === "References")?.value
    ).toContain("=?UTF-8?B?");
  });
});
