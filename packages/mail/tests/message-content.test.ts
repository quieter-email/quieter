import { describe, expect, test } from "vite-plus/test";
import { decodePartBody } from "../src/message-content";

const base64UrlEncode = (value: string, encoding: BufferEncoding = "utf8") =>
  Buffer.from(value, encoding).toString("base64url");

const decodeHtmlPart = (
  html: string,
  options: {
    charset?: string;
    encoding?: BufferEncoding;
    transferEncoding?: string;
  } = {},
) =>
  decodePartBody({
    mimeType: "text/html",
    headers: [
      { name: "Content-Type", value: `text/html; charset=${options.charset ?? "utf-8"}` },
      { name: "Content-Transfer-Encoding", value: options.transferEncoding ?? "quoted-printable" },
    ],
    body: {
      data: base64UrlEncode(html, options.encoding),
    },
  });

describe("decodePartBody", () => {
  test("does not quoted-printable decode Gmail full payload body data a second time", () => {
    expect(
      decodeHtmlPart(
        '<a href="https://auth.example.com/api/verify?token=abc78113-8ee4-46c6-9470-602de4241769">Verify</a>',
      ),
    ).toContain("https://auth.example.com/api/verify?token=abc78113-8ee4-46c6-9470-602de4241769");

    expect(
      decodeHtmlPart(
        '<a href="https://courses.example.edu/mod/forum/discuss.php?d=737256#p1277948">Forum</a>',
      ),
    ).toContain("https://courses.example.edu/mod/forum/discuss.php?d=737256#p1277948");

    expect(
      decodeHtmlPart(
        '<a href="https://meet.example.net/j/66359286654?pwd=eBcGiWFrDO0jhH8mM01lPV6UaUebTX.1">Meeting</a>',
      ),
    ).toContain("https://meet.example.net/j/66359286654?pwd=eBcGiWFrDO0jhH8mM01lPV6UaUebTX.1");
  });

  test("decodes Gmail full payload body data with the part charset", () => {
    expect(
      decodeHtmlPart("Zukünftige Hybrid-Vorlesungen", {
        charset: "iso-8859-1",
        encoding: "latin1",
      }),
    ).toBe("Zukünftige Hybrid-Vorlesungen");
  });
});
