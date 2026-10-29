import { describe, expect, test } from "vite-plus/test";

import {
  API_COMPATIBILITY_DATE,
  API_VERSION_HEADER,
  rejectApiCompatibility,
} from "../src/public-api";

describe("api compatibility date", () => {
  test("accepts the current date, including surrounding spaces", () => {
    expect(
      rejectApiCompatibility(
        new Headers({ [API_VERSION_HEADER]: API_COMPATIBILITY_DATE })
      )
    ).toBeNull();
    expect(
      rejectApiCompatibility(
        new Headers({
          [API_VERSION_HEADER]: `  ${API_COMPATIBILITY_DATE}  `,
        })
      )
    ).toBeNull();
  });

  test("rejects a missing or different date", () => {
    for (const headers of [
      new Headers(),
      new Headers({ [API_VERSION_HEADER]: "2026-07" }),
      new Headers({ [API_VERSION_HEADER]: `${API_COMPATIBILITY_DATE}-29` }),
    ]) {
      const response = rejectApiCompatibility(headers);
      expect(response?.status).toBe(400);
      expect(response?.headers.get(API_VERSION_HEADER)).toBe(
        API_COMPATIBILITY_DATE
      );
    }
  });
});
