import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { installStaleDeploymentRecovery } from "./stale-deployment";

describe("stale deployment recovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("reloads once without converting a rejected import into undefined", () => {
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
    installStaleDeploymentRecovery();

    const failure = new Event("vite:preloadError", { cancelable: true });
    target.dispatchEvent(failure);
    expect(failure.defaultPrevented).toBeFalsy();
    expect(reload).toHaveBeenCalledOnce();

    const repeatedFailure = new Event("vite:preloadError", {
      cancelable: true,
    });
    target.dispatchEvent(repeatedFailure);
    expect(repeatedFailure.defaultPrevented).toBeFalsy();
    expect(reload).toHaveBeenCalledOnce();
  });
});
