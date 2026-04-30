import { describe, expect, test } from "bun:test";
import { extractListUnsubscribeTargets } from "../src/gmail-service";

describe("extractListUnsubscribeTargets", () => {
  test("extracts mailto and url targets", () => {
    expect(
      extractListUnsubscribeTargets(
        "<https://example.com/unsubscribe?id=123>, <mailto:list@example.com?subject=unsubscribe>",
      ),
    ).toEqual({
      mailto: "mailto:list@example.com?subject=unsubscribe",
      url: "https://example.com/unsubscribe?id=123",
    });
  });

  test("keeps the first valid target for each supported scheme", () => {
    expect(
      extractListUnsubscribeTargets(
        "<mailto:first@example.com>, <mailto:second@example.com>, <https://example.com/first>, <https://example.com/second>",
      ),
    ).toEqual({
      mailto: "mailto:first@example.com",
      url: "https://example.com/first",
    });
  });

  test("ignores unsupported and invalid targets", () => {
    expect(
      extractListUnsubscribeTargets(
        "<ftp://example.com/unsubscribe>, <javascript:alert(1)>, <mailto:>, <https://example.com/unsubscribe>",
      ),
    ).toEqual({
      mailto: undefined,
      url: "https://example.com/unsubscribe",
    });
  });
});
