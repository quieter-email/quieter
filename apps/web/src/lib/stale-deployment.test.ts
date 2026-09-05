import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { handleDeploymentPreloadError } from "./stale-deployment";

describe("stale deployment notice", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("preserves import rejections without automatic reloads or storage writes", () => {
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
});
