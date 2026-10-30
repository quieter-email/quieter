import { describe, expect, test } from "vite-plus/test";

import { extractInlineMessageAttachments } from "../src/message-content";
import { parseImageSourceSet } from "../src/source-set";

describe(parseImageSourceSet, () => {
  test("retains image candidates, descriptors, and internal data URL commas", () => {
    expect(
      parseImageSourceSet(
        " , cid:logo,\tdata:image/png;base64,AAAA 2x, https://example.test/a 640w"
      )
    ).toStrictEqual([
      { descriptor: "", source: "cid:logo" },
      { descriptor: "2x", source: "data:image/png;base64,AAAA" },
      { descriptor: "640w", source: "https://example.test/a" },
    ]);
    expect(parseImageSourceSet("cid:a .5x, cid:b 1.5x")).toHaveLength(2);
  });

  test.each([" ", "\t", "\r", "\n", "\f", "\u00A0"])(
    "preserves existing whitespace semantics for %j",
    (space) => {
      expect(
        parseImageSourceSet(`${space},cid:a${space}2x,${space}cid:b,`)
      ).toStrictEqual([
        { descriptor: "2x", source: "cid:a" },
        { descriptor: "", source: "cid:b" },
      ]);
    }
  );

  test("handles long comma runs without backtracking and preserves their meaning", () => {
    const source = `cid:a${",".repeat(100_000)}!`;
    expect(parseImageSourceSet(`${source},`)).toStrictEqual([
      { descriptor: "", source },
    ]);
    expect(parseImageSourceSet(`${source} 2x, cid:b`)).toHaveLength(2);
  });

  test("rejects a malformed descriptor without exposing partial candidates", () => {
    expect(
      parseImageSourceSet(`cid:a 1x, cid:b ${"1".repeat(100_000)}!`)
    ).toStrictEqual([]);
    expect(parseImageSourceSet("cid:a 1x, cid:b 2x 3x")).toStrictEqual([]);
  });

  test("handles many separate candidates", () => {
    expect(parseImageSourceSet("cid:a, ".repeat(10_000))).toHaveLength(10_000);
  });

  test.each([",", "&#44;", "&#x2c;", "&comma;"])(
    "extracts inline attachments after HTML tokenization of %s",
    (comma) => {
      const payload = {
        parts: [
          {
            body: { attachmentId: "inline", size: 3 },
            filename: "logo.png",
            headers: [{ name: "Content-ID", value: "<logo>" }],
            mimeType: "image/png",
          },
        ],
      };
      const html = `<picture><SOURCE SRCSET='cid:logo${comma} cid:a${comma.repeat(2000)}! 2x'></picture>`;
      expect(extractInlineMessageAttachments(payload, html)).toMatchObject([
        { attachmentId: "inline", contentId: "logo" },
      ]);
      expect(
        extractInlineMessageAttachments(
          payload,
          '<img srcset="cid:logo 1x, cid:b invalid">'
        )
      ).toStrictEqual([]);
    }
  );
});
