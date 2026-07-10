import { describe, expect, test } from "vite-plus/test";
import { getSafeAuthReturnTo } from "./return-to";

describe("getSafeAuthReturnTo", () => {
  test("keeps same-origin paths with search and hash", () => {
    expect(getSafeAuthReturnTo("/?compose=mailto&mailto=mailto%3Aalex%40example.com#top")).toBe(
      "/?compose=mailto&mailto=mailto%3Aalex%40example.com#top",
    );
  });

  test("rejects missing, absolute, protocol-relative, and backslash paths", () => {
    expect(getSafeAuthReturnTo(null)).toBeUndefined();
    expect(getSafeAuthReturnTo("https://quieter.email/")).toBeUndefined();
    expect(getSafeAuthReturnTo("//quieter.email/")).toBeUndefined();
    expect(getSafeAuthReturnTo("/\\evil.example")).toBeUndefined();
  });

  test("normalizes same-origin path traversal", () => {
    expect(getSafeAuthReturnTo("/settings/../?mailbox=inbox")).toBe("/?mailbox=inbox");
  });
});
