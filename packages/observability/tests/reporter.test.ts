import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { configureErrorReporter, reportError } from "../src/index";
import type { ErrorReporter } from "../src/index";

describe("error reporter recovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    configureErrorReporter(vi.fn<ErrorReporter>());
  });

  test("falls back locally after a reporter failure and reports the next error", () => {
    const reporter = vi.fn<ErrorReporter>().mockImplementationOnce(() => {
      throw new Error("Reporter unavailable");
    });
    const fallback = vi.spyOn(console, "error").mockImplementation(() => {});
    configureErrorReporter(reporter);
    const first = new Error("First failure");
    const second = new Error("Second failure", { cause: first });
    const context = { operation: "test:recovery" };

    expect(() => {
      reportError(first, context);
    }).not.toThrow();
    expect(fallback).toHaveBeenCalledWith(
      "Error reporting failed",
      first,
      context
    );
    reportError(second, context);
    expect(reporter).toHaveBeenLastCalledWith(second, context);
  });
});
