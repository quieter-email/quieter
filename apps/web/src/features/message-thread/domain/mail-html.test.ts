import { describe, expect, test } from "bun:test";
import { linkifyText } from "./mail-html";

describe("linkifyText", () => {
  test("turns bare http urls into link segments", () => {
    expect(
      linkifyText(
        "Join https://meet.example.net/j/66359286654?pwd=eBcGiWFrDO0jhH8mM01lPV6UaUebTX.1 now",
      ),
    ).toEqual([
      { kind: "text", value: "Join " },
      {
        kind: "link",
        href: "https://meet.example.net/j/66359286654?pwd=eBcGiWFrDO0jhH8mM01lPV6UaUebTX.1",
        value: "https://meet.example.net/j/66359286654?pwd=eBcGiWFrDO0jhH8mM01lPV6UaUebTX.1",
      },
      { kind: "text", value: " now" },
    ]);
  });

  test("keeps trailing sentence punctuation outside the link", () => {
    expect(linkifyText("Open https://example.com/path?token=abc123.")).toEqual([
      { kind: "text", value: "Open " },
      {
        kind: "link",
        href: "https://example.com/path?token=abc123",
        value: "https://example.com/path?token=abc123",
      },
      { kind: "text", value: "." },
    ]);
  });
});
