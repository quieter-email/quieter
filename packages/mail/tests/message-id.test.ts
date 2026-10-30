import { describe, expect, test } from "vite-plus/test";

import { extractMessageIds, getReplyReferenceIds } from "../src/message-id";
import { parseRawMailMessage } from "../src/raw-message";

describe(extractMessageIds, () => {
  test("retains ordered references and leaves deduplication to the caller", () => {
    expect(
      extractMessageIds(
        "comment <root@example.com>\r\n\t<parent@example.com> <root@example.com>"
      )
    ).toStrictEqual([
      "<root@example.com>",
      "<parent@example.com>",
      "<root@example.com>",
    ]);
    expect(extractMessageIds()).toStrictEqual([]);
    expect(extractMessageIds(null)).toStrictEqual([]);
  });

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

  test("applies the decoded field length boundary before extracting any IDs", () => {
    const reference = "<root@example.com>";
    const atLimit = reference.padEnd(65_536, " ");
    expect(extractMessageIds(atLimit)).toStrictEqual([reference]);
    expect(extractMessageIds(`${atLimit} `)).toStrictEqual([]);
    expect(getReplyReferenceIds({ inReplyTo: atLimit })).toStrictEqual([
      reference,
    ]);
    expect(
      getReplyReferenceIds({
        inReplyTo: "<other@example.com>".padEnd(65_537, " "),
        references: reference,
      })
    ).toStrictEqual([reference]);
  });

  test("retains the complete chain at the reference limit", () => {
    const references = Array.from(
      { length: 1000 },
      (_, index) => `<${index}@example.com>`
    );
    expect(extractMessageIds(references.join(" "))).toStrictEqual(references);
    expect(
      extractMessageIds([...references, "<overflow@example.com>"].join(" "))
    ).toStrictEqual([]);
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

  test("keeps the complete In-Reply-To value first and deduplicates ingestion IDs", () => {
    expect(
      getReplyReferenceIds({
        inReplyTo: " <parent@example.com> ",
        references:
          "<root@example.com> <parent@example.com> <root@example.com>",
      })
    ).toStrictEqual(["<parent@example.com>", "<root@example.com>"]);
    expect(getReplyReferenceIds({ inReplyTo: "legacy-parent" })).toStrictEqual([
      "legacy-parent",
    ]);
    expect(
      getReplyReferenceIds({ inReplyTo: "<one@example.com> <two@example.com>" })
    ).toStrictEqual(["<one@example.com> <two@example.com>"]);
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
