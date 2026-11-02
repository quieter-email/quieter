import { describe, expect, test, vi } from "vite-plus/test";

import { Route } from "../routes/api/site-password";

vi.mock(import("#/lib/site-password.server"), async (importOriginal) => ({
  ...(await importOriginal()),
  getSitePasswordToken: () => "synthetic-unlock-token",
  isCorrectSitePassword: (password: string) =>
    password === "synthetic-password",
}));

const postSitePassword = async (request: Request) => {
  const handlers = Route.options.server?.handlers;
  if (
    handlers === undefined ||
    typeof handlers === "function" ||
    !("POST" in handlers) ||
    typeof handlers.POST !== "function"
  ) {
    throw new Error("Site password POST handler is unavailable");
  }
  const response = await handlers.POST({
    context: undefined,
    next: () => {
      throw new Error("Unexpected fallthrough");
    },
    params: {},
    pathname: "/api/site-password",
    request,
  });
  if (!(response instanceof Response)) {
    throw new Error("Site password handler did not return a response");
  }
  return response;
};

describe("site password return redirects", () => {
  test.each([
    "/.//attacker.example/phish",
    "/%2e//attacker.example/phish",
    "/a/..//attacker.example/phish",
    "/\\attacker.example/phish",
    "/\t/attacker.example/phish",
  ])("keeps successful unlocks same-origin for %j", async (returnTo) => {
    const requestUrl = "https://quieter.example/api/site-password";
    const response = await postSitePassword(
      new Request(requestUrl, {
        body: new URLSearchParams({ password: "synthetic-password", returnTo }),
        method: "POST",
      })
    );
    expect(response.status).toBe(302);
    expect(
      new URL(response.headers.get("location") ?? "", requestUrl).origin
    ).toBe(new URL(requestUrl).origin);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  test.each(["form", "referer", "file"])(
    "validates the %s return target and preserves internal destinations",
    async (source) => {
      const requestUrl = "https://quieter.example/api/site-password";
      for (const returnTo of [
        "/.//attacker.example/phish",
        "/settings/../inbox?mailbox=inbox#top",
      ]) {
        const body = new FormData();
        body.set("password", "synthetic-password");
        if (source === "form") {
          body.set("returnTo", returnTo);
        }
        if (source === "file") {
          body.set("returnTo", new Blob(["ignored"]), "return.txt");
        }
        const referer = new URL("/site-password", requestUrl);
        referer.searchParams.set("returnTo", returnTo);
        const response = await postSitePassword(
          new Request(requestUrl, {
            body,
            headers: { referer: referer.href },
            method: "POST",
          })
        );
        const destination = new URL(
          response.headers.get("location") ?? "",
          requestUrl
        );
        expect(destination.origin).toBe(new URL(requestUrl).origin);
        expect(destination.pathname).toBe(
          returnTo.includes("attacker") ? "/" : "/inbox"
        );
        expect(destination.search).toBe(
          returnTo.includes("attacker") ? "" : "?mailbox=inbox"
        );
        expect(destination.hash).toBe(
          returnTo.includes("attacker") ? "" : "#top"
        );
      }
    }
  );

  test.each(["", "https://attacker.example", "/.//attacker.example"])(
    "keeps rejected passwords on the gate and does not replace explicit invalid input %j with the Referer",
    async (returnTo) => {
      const requestUrl = "https://quieter.example/api/site-password";
      const response = await postSitePassword(
        new Request(requestUrl, {
          body: new URLSearchParams({ password: "incorrect", returnTo }),
          headers: {
            referer: "https://quieter.example/site-password?returnTo=%2Finbox",
          },
          method: "POST",
        })
      );
      const destination = new URL(
        response.headers.get("location") ?? "",
        requestUrl
      );
      expect(destination.origin).toBe(new URL(requestUrl).origin);
      expect(destination.pathname).toBe("/site-password");
      expect(destination.searchParams.get("returnTo")).toBe("/");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  );
});
