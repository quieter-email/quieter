import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import {
  detectNewDeployment,
  installStaleDeploymentRecovery,
} from "./stale-deployment";

const currentBuildId = "build-current";

type StubbedResponse =
  | "network-error"
  | Response
  | { body: string; contentType: string; ok?: boolean };

const stubBuildIdResponse = (stub: StubbedResponse) => {
  vi.stubGlobal("__QUIETER_BUILD_ID__", currentBuildId);
  let response: Promise<Response>;
  if (stub === "network-error") {
    response = Promise.reject(new Error("offline"));
  } else if (stub instanceof Response) {
    response = Promise.resolve(stub);
  } else {
    response = Promise.resolve(
      new Response(stub.body, {
        headers: { "content-type": stub.contentType },
        status: stub.ok === false ? 404 : 200,
      })
    );
  }
  vi.stubGlobal(
    "fetch",
    vi.fn<() => Promise<Response>>().mockReturnValue(response)
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

  test("treats a failed response body read as unknown", async () => {
    stubBuildIdResponse(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("stream interrupted"));
          },
        }),
        { headers: { "content-type": "text/plain" } }
      )
    );

    await expect(detectNewDeployment()).resolves.toBeNull();
  });
});

describe(installStaleDeploymentRecovery, () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("reloads after an initially unknown preload failure proves stale", async () => {
    stubBuildIdResponse({ body: currentBuildId, contentType: "text/plain" });
    await detectNewDeployment();
    stubBuildIdResponse({ body: "build-next", contentType: "text/plain" });
    const documentTarget = Object.assign(new EventTarget(), {
      visibilityState: "hidden",
    });
    const storedValues = new Map<string, string>();
    const reload = vi.fn<() => void>();
    const windowTarget = Object.assign(new EventTarget(), {
      location: { reload },
      sessionStorage: {
        getItem: (key: string) => storedValues.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storedValues.set(key, value);
        },
      },
    });
    vi.stubGlobal("document", documentTarget);
    vi.stubGlobal("window", windowTarget);
    vi.mocked(fetch).mockClear();

    installStaleDeploymentRecovery();
    windowTarget.dispatchEvent(new Event("vite:preloadError"));
    windowTarget.dispatchEvent(new Event("vite:preloadError"));

    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledOnce();
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("detects on visibility and reloads only once for that deployment", async () => {
    stubBuildIdResponse({ body: currentBuildId, contentType: "text/plain" });
    await detectNewDeployment();
    stubBuildIdResponse({ body: "build-next", contentType: "text/plain" });
    const documentTarget = Object.assign(new EventTarget(), {
      visibilityState: "visible",
    });
    const storedValues = new Map<string, string>();
    const reload = vi.fn<() => void>();
    const windowTarget = Object.assign(new EventTarget(), {
      location: { reload },
      sessionStorage: {
        getItem: (key: string) => storedValues.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storedValues.set(key, value);
        },
      },
    });
    vi.stubGlobal("document", documentTarget);
    vi.stubGlobal("window", windowTarget);
    vi.mocked(fetch).mockClear();

    installStaleDeploymentRecovery();
    documentTarget.dispatchEvent(new Event("visibilitychange"));

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
    });
    expect(reload).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      windowTarget.dispatchEvent(
        new Event("vite:preloadError", { cancelable: true })
      );
      expect(reload).toHaveBeenCalledOnce();
    });
    windowTarget.dispatchEvent(
      new Event("vite:preloadError", { cancelable: true })
    );

    expect(reload).toHaveBeenCalledOnce();
  });
});
