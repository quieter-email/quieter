import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { detectNewDeployment } from "./stale-deployment";

const currentBuildId = "build-current";

type StubbedResponse =
  | "network-error"
  | { body: string; contentType: string; ok?: boolean };

const stubBuildIdResponse = (stub: StubbedResponse) => {
  vi.stubGlobal("__QUIETER_BUILD_ID__", currentBuildId);
  vi.stubGlobal(
    "fetch",
    stub === "network-error"
      ? vi.fn<() => Promise<Response>>().mockRejectedValue(new Error("offline"))
      : vi.fn<() => Promise<Response>>().mockResolvedValue(
          new Response(stub.body, {
            headers: { "content-type": stub.contentType },
            status: stub.ok === false ? 404 : 200,
          })
        )
  );
};

describe(detectNewDeployment, () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("reports the deployed build id when the release moved on", async () => {
    stubBuildIdResponse({ body: "build-next\n", contentType: "text/plain" });

    await expect(detectNewDeployment()).resolves.toBe("build-next");
  });

  test("reports nothing when the deployment still matches", async () => {
    stubBuildIdResponse({ body: currentBuildId, contentType: "text/plain" });

    await expect(detectNewDeployment()).resolves.toBeNull();
  });

  test("treats the SPA shell fallback as unknown rather than stale", async () => {
    // A missing build id file falls through to the shell. Reading that HTML as
    // a mismatch would reload on exactly the genuine failures this leaves alone.
    stubBuildIdResponse({
      body: "<!doctype html><html lang='en'></html>",
      contentType: "text/html; charset=utf-8",
    });

    await expect(detectNewDeployment()).resolves.toBeNull();
  });

  test("treats a non-ok response as unknown rather than stale", async () => {
    stubBuildIdResponse({
      body: "build-next",
      contentType: "text/plain",
      ok: false,
    });

    await expect(detectNewDeployment()).resolves.toBeNull();
  });

  test("treats an empty body as unknown rather than stale", async () => {
    stubBuildIdResponse({ body: "  \n", contentType: "text/plain" });

    await expect(detectNewDeployment()).resolves.toBeNull();
  });

  test("survives the check itself failing", async () => {
    stubBuildIdResponse("network-error");

    await expect(detectNewDeployment()).resolves.toBeNull();
  });
});
