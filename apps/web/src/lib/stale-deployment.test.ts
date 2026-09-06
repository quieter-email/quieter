/* oxlint-disable eslint/require-await -- Mock fetch keeps the asynchronous browser contract. */
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { handleDeploymentPreloadError } from "./stale-deployment";

vi.mock(import("react"), async (importOriginal) => ({
  ...(await importOriginal()),
  useSyncExternalStore: <Snapshot>(
    _subscribe: unknown,
    getSnapshot: () => Snapshot
  ) => getSnapshot(),
}));

describe("stale deployment notice", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("preserves import rejections without automatic reloads or storage writes", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"))
    );
    const target = new EventTarget();
    const stored = new Map<string, string>();
    const reload = vi.fn<() => void>();
    vi.stubGlobal("window", {
      addEventListener: target.addEventListener.bind(target),
      location: { reload },
      sessionStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
      },
    });
    target.addEventListener("vite:preloadError", handleDeploymentPreloadError);

    const failure = Object.assign(
      new Event("vite:preloadError", { cancelable: true }),
      {
        payload: new TypeError(
          "Failed to fetch dynamically imported module: /assets/old.js"
        ),
      }
    );
    target.dispatchEvent(failure);
    expect(failure.defaultPrevented).toBeFalsy();
    expect(reload).not.toHaveBeenCalled();

    const repeatedFailure = Object.assign(
      new Event("vite:preloadError", { cancelable: true }),
      { payload: failure.payload }
    );
    target.dispatchEvent(repeatedFailure);
    expect(repeatedFailure.defaultPrevented).toBeFalsy();
    expect(reload).not.toHaveBeenCalled();
    expect(stored.size).toBe(0);
  });

  test.each(["same", "changed", "offline", "html", "empty"])(
    "only announces a confirmed update: %s",
    async (scenario) => {
      vi.resetModules();
      vi.stubGlobal("__QUIETER_BUILD_ID__", "same");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (scenario === "offline") {
            throw new Error("offline");
          }
          return new Response(scenario === "empty" ? "" : scenario, {
            headers: {
              "content-type": scenario === "html" ? "text/html" : "text/plain",
            },
          });
        })
      );
      const { checkForDeploymentUpdate, useDeploymentUpdateRequired } =
        await import("./stale-deployment");
      await checkForDeploymentUpdate();
      expect(useDeploymentUpdateRequired()).toBe(scenario === "changed");
    }
  );
});
