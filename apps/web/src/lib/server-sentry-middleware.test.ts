import { ORPCError } from "@orpc/server";
import { notFound, redirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { withServerErrorReporting } from "./server-sentry-middleware";

const captureException = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => string>()
);

vi.mock(import("@sentry/cloudflare"), () => ({ captureException }));

describe("server Sentry middleware", () => {
  beforeEach(() => {
    captureException.mockClear();
  });

  test("captures errors before TanStack serializes them", async () => {
    const error = new Error("Route failed");
    await expect(
      withServerErrorReporting(
        vi.fn<() => Promise<void>>().mockRejectedValue(error),
        "auto.middleware.tanstackstart.request"
      )
    ).rejects.toBe(error);
    expect(captureException).toHaveBeenCalledWith(error, {
      mechanism: {
        handled: false,
        type: "auto.middleware.tanstackstart.request",
      },
    });
  });

  test("keeps redirects, missing routes and expected API errors out of Sentry", async () => {
    for (const error of [
      redirect({ href: "/home" }),
      notFound(),
      new ORPCError("UNAUTHORIZED"),
      new ORPCError("BAD_REQUEST"),
      new Response(null, { status: 403 }),
    ]) {
      await expect(
        withServerErrorReporting(
          vi.fn<() => Promise<void>>().mockRejectedValue(error),
          "auto.middleware.tanstackstart.server_function"
        )
      ).rejects.toBe(error);
    }
    expect(captureException).not.toHaveBeenCalled();
  });

  test("reports unexpected server API failures", async () => {
    const error = new ORPCError("INTERNAL_SERVER_ERROR");
    await expect(
      withServerErrorReporting(
        vi.fn<() => Promise<void>>().mockRejectedValue(error),
        "auto.middleware.tanstackstart.server_function"
      )
    ).rejects.toBe(error);
    expect(captureException).toHaveBeenCalledOnce();
  });
});
