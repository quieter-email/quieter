/* oxlint-disable vitest/no-conditional-expect, eslint/require-await -- Table-driven transport fixtures cover success and rejection paths. */
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { checkDeployment } from "./check-deployment.ts";

describe("deployment smoke checks", () => {
  afterEach(() => vi.unstubAllGlobals());

  test.each([
    "healthy",
    "wrong-server",
    "wrong-assets",
    "database-down",
    "empty-html",
    "missing-chunk",
    "html-chunk",
  ])("checks %s", async (failure) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const { pathname } = new URL(input);
        if (pathname === "/api/health") {
          return Response.json(
            {
              buildId: failure === "wrong-server" ? "old" : "new",
              healthy: true,
            },
            { status: failure === "database-down" ? 503 : 200 }
          );
        }
        if (pathname === "/assets/build-id.txt") {
          return new Response(failure === "wrong-assets" ? "old" : "new");
        }
        if (pathname === "/about") {
          return new Response(
            failure === "empty-html"
              ? "<html></html>"
              : '<h1>About</h1><script src="/assets/app.js"></script><link href="/assets/app.css" rel="stylesheet">',
            { headers: { "content-type": "text/html" } }
          );
        }
        const assetType = pathname.endsWith(".js")
          ? "text/javascript"
          : "text/css";
        return new Response("asset", {
          headers: {
            "content-type": failure === "html-chunk" ? "text/html" : assetType,
          },
          status: failure === "missing-chunk" ? 404 : 200,
        });
      })
    );
    if (failure === "healthy") {
      await expect(
        checkDeployment("https://example.test", "new")
      ).resolves.toBeUndefined();
    } else {
      await expect(
        checkDeployment("https://example.test", "new")
      ).rejects.toThrow(/./u);
    }
  });
});
