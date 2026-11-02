import { getSafeAuthReturnTo } from "@quieter/app/lib/return-to";
import { describe, expect, test } from "vite-plus/test";

describe(getSafeAuthReturnTo, () => {
  test("keeps same-origin paths with search and hash", () => {
    expect(
      getSafeAuthReturnTo(
        "/?compose=mailto&mailto=mailto%3Aalex%40example.com#top"
      )
    ).toBe("/?compose=mailto&mailto=mailto%3Aalex%40example.com#top");
  });

  test("rejects missing, absolute, protocol-relative, and backslash paths", () => {
    expect(getSafeAuthReturnTo(null)).toBeUndefined();
    expect(getSafeAuthReturnTo("https://quieter.email/")).toBeUndefined();
    expect(getSafeAuthReturnTo("//quieter.email/")).toBeUndefined();
    expect(getSafeAuthReturnTo("/\\evil.example")).toBeUndefined();
  });

  test("normalizes same-origin path traversal", () => {
    expect(getSafeAuthReturnTo("/settings/../?mailbox=inbox")).toBe(
      "/?mailbox=inbox"
    );
  });

  test.each([
    "/.//attacker.example/phish",
    "/%2e//attacker.example/phish",
    "/a/..//attacker.example/phish",
    "/a/%2e%2e//attacker.example/phish",
    "/a/.%2e//attacker.example/phish",
    "/safe\n/..//attacker.example/phish",
    "/\t/attacker.example/phish",
    "/\\attacker.example/phish",
  ])("rejects a normalized network-path reference %j", (value) => {
    expect(getSafeAuthReturnTo(value)).toBeUndefined();
  });

  test("accepted paths stay same-origin at both redirect sinks", () => {
    const requestUrl = "https://quieter.example/site-password";
    for (const segment of [".", "%2e", "..", "%2e%2e", ".%2e", "%2e."]) {
      for (const suffix of [
        "/inbox",
        "//attacker.example",
        "/%2f%2fattacker.example",
      ]) {
        for (const prefix of ["/", "/settings/", "/safe\n/"]) {
          const path =
            getSafeAuthReturnTo(`${prefix}${segment}${suffix}?q=hello#top`) ??
            "/";
          const middlewareResponse = Response.redirect(
            new URL(path, requestUrl),
            302
          );
          const postResponse = new Response(null, {
            headers: { location: path },
            status: 302,
          });
          expect(
            new URL(
              middlewareResponse.headers.get("location") ?? "",
              requestUrl
            ).origin
          ).toBe(new URL(requestUrl).origin);
          expect(
            new URL(postResponse.headers.get("location") ?? "", requestUrl)
              .origin
          ).toBe(new URL(requestUrl).origin);
        }
      }
    }
  });
});
