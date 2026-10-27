import { describe, expect, test } from "vite-plus/test";

import { regionalTimeFormat } from "../src/regional-time";

describe("regional time preference", () => {
  test("uses the preferred supported region's hour cycle", () => {
    expect(regionalTimeFormat("en-GB;q=0.7,en-US;q=0.9")).toBe("12h");
    expect(regionalTimeFormat("en-US;q=0.5,de-DE;q=1")).toBe("24h");
  });

  test("ignores invalid, unsupported, wildcard, and disabled language ranges", () => {
    expect(
      regionalTimeFormat("invalid_locale,xx-XX,*;q=0.9,en-US;q=0,de-DE;q=0.5")
    ).toBe("24h");
    expect(regionalTimeFormat("en-GB;q=invalid,en-US;q=0.8")).toBe("12h");
  });

  test("has a stable fallback without a regional signal", () => {
    expect(regionalTimeFormat(null)).toBe(regionalTimeFormat("*"));
    expect(regionalTimeFormat()).toBe(regionalTimeFormat("en-US;q=0"));
  });
});
