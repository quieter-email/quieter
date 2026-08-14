import { describe, expect, it, vi } from "vite-plus/test";

import {
  getPosthogReady,
  markPosthogReady,
  subscribeToPosthogReady,
} from "./posthog";

describe("PostHog readiness", () => {
  it("notifies subscribers when the consent-gated SDK finishes loading", () => {
    const listener = vi.fn<() => void>();
    const unsubscribe = subscribeToPosthogReady(() => {
      listener();
    });

    markPosthogReady();

    expect(getPosthogReady()).toBeTruthy();
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    markPosthogReady();
    expect(listener).toHaveBeenCalledOnce();
  });
});
