import {
  createExecutionContext,
  createMessageBatch,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vite-plus/test";

import { handleRuntimeHealthRequest } from "../src/runtime-health.ts";
import { withSentryReporting } from "../src/worker-runtime.ts";

const token = "a".repeat(64);
const bindings = {
  QUIETER_RUNTIME_HEALTH: JSON.stringify({
    publicHosts: ["mail.example.com"],
    stage: "release-proof-health",
  }),
  QUIETER_VERSION: { id: "00000000-0000-4000-8000-000000000269" },
  SST_RESOURCES_JSON: JSON.stringify({
    App: { stage: "release-proof-health" },
    ReleaseProofToken: { value: token },
  }),
};

describe("native runtime release health", () => {
  it("reports the actual binding version and prevents caching", async () => {
    const response = handleRuntimeHealthRequest(
      new Request("https://candidate.workers.dev/__release/health", {
        headers: { authorization: `Bearer ${token}` },
      }),
      bindings
    );
    await expect(response?.json()).resolves.toStrictEqual({
      checks: { startup: true },
      versionId: bindings.QUIETER_VERSION.id,
    });
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    { headers: new Headers(), method: "GET" },
    {
      headers: new Headers({ authorization: `Bearer ${"b".repeat(64)}` }),
      method: "GET",
    },
    {
      headers: new Headers({ authorization: `Bearer ${token}` }),
      method: "POST",
    },
  ])(
    "does not expose health without the intended credential and method",
    (options) => {
      expect(
        handleRuntimeHealthRequest(
          new Request("https://mail.example.com/__release/health", options),
          bindings
        )?.status
      ).toBe(404);
    }
  );

  it("blocks all application routes on preview hosts even with the health token", () => {
    expect(
      handleRuntimeHealthRequest(
        new Request("https://candidate.workers.dev/api/v2/send", {
          headers: { authorization: `Bearer ${token}` },
          method: "POST",
        }),
        bindings
      )?.status
    ).toBe(404);
    expect(
      handleRuntimeHealthRequest(
        new Request("https://mail.example.com/api/v2/send"),
        bindings
      )
    ).toBeNull();
    expect(
      handleRuntimeHealthRequest(
        new Request("https://mail.example.com/__release/health"),
        {}
      )?.status
    ).toBe(404);
  });

  it("fails closed when enabled bindings are incomplete", () => {
    expect(
      handleRuntimeHealthRequest(
        new Request("https://mail.example.com/api/v2/send"),
        { ...bindings, QUIETER_VERSION: undefined }
      )?.status
    ).toBe(404);
  });

  it("adds health to queue handlers without altering their trigger or invoking application fetch", async () => {
    const applicationFetch = vi.fn<ExportedHandlerFetchHandler<Env>>(
      () => new Response("application")
    );
    const queue = vi.fn<ExportedHandlerQueueHandler<Env>>();
    const handler = withSentryReporting({ fetch: applicationFetch, queue });
    const context = createExecutionContext();
    const response = await handler.fetch(
      new Request<unknown, IncomingRequestCfProperties>(
        "https://candidate.workers.dev/__release/health",
        {
          headers: { authorization: `Bearer ${token}` },
        }
      ),
      { ...env, ...bindings },
      context
    );
    await waitOnExecutionContext(context);
    expect(response.status).toBe(200);
    expect(applicationFetch).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
    const queueContext = createExecutionContext();
    await handler.queue(
      createMessageBatch("health-fixture", []),
      { ...env, ...bindings },
      queueContext
    );
    await waitOnExecutionContext(queueContext);
    expect(queue).toHaveBeenCalledOnce();
  });
});
