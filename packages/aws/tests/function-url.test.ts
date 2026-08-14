import { describe, expect, test } from "vite-plus/test";

import {
  bearerTokenMatches,
  getBearerToken,
  parseEventJson,
} from "../src/function-url";

describe("function URL helpers", () => {
  test("compares bearer tokens without accepting missing or different values", () => {
    expect(bearerTokenMatches("secret", "secret")).toBeTruthy();
    expect(bearerTokenMatches("different", "secret")).toBeFalsy();
    expect(bearerTokenMatches(null, "secret")).toBeFalsy();
  });

  test("reads bearer tokens case-insensitively", () => {
    expect(getBearerToken({ AUTHORIZATION: "Bearer secret" })).toBe("secret");
  });

  test("parses plain and base64 JSON bodies", () => {
    expect(parseEventJson({ body: '{"ok":true}' })).toStrictEqual({ ok: true });
    expect(
      parseEventJson({
        body: Buffer.from('{"ok":true}').toString("base64"),
        isBase64Encoded: true,
      })
    ).toStrictEqual({ ok: true });
  });
});
