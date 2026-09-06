import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { observeRelease } from "../src/health.ts";
import type { ReleaseAttempt } from "../src/schema.ts";

const fixture = () => {
  const versionId = randomUUID();
  const release = {
    id: "release",
    services: [
      {
        artifactDigest: "b".repeat(64),
        bindingGeneration: "c".repeat(64),
        contracts: ["v1"],
        requirements: {},
        scriptName: "probe",
        service: "web",
        versionId,
      },
    ],
    sourceSha: "a".repeat(40),
  };
  const attempt: ReleaseAttempt = {
    baseline: release,
    candidate: release,
    deadline: new Date(Date.now() + 600_000).toISOString(),
    deployments: {},
    failure: null,
    health: null,
    id: "attempt",
    intent: null,
    mode: "promote",
    observationStartedAt: new Date().toISOString(),
    order: ["web"],
    status: "observing",
    workflowRunId: "1",
  };
  return {
    attempt,
    probes: { web: { checks: ["ready"], url: "https://probe.example/health" } },
    versionId,
  };
};

describe("release health observation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("requires sustained authenticated samples of the exact version", async () => {
    vi.useFakeTimers();
    const { attempt, probes, versionId } = fixture();
    // oxlint-disable-next-line require-await -- Fetch mocks must return a fresh readable response asynchronously.
    const request = vi.fn<typeof fetch>().mockImplementation(async () => {
      const response = Response.json({ checks: { ready: true }, versionId });
      return response;
    });
    vi.stubGlobal("fetch", request);
    const observation = observeRelease(
      attempt,
      probes,
      "t".repeat(32),
      // oxlint-disable-next-line require-await -- Simulate the observation interval without waiting two minutes.
      async (milliseconds) => {
        vi.setSystemTime(Date.now() + milliseconds);
      }
    );
    const evidence = await observation;
    expect(evidence.services.web).toStrictEqual({
      failures: 0,
      samples: 13,
      versionId,
    });
    expect(
      Date.parse(evidence.finishedAt) - Date.parse(evidence.startedAt)
    ).toBe(120_000);
    expect(request).toHaveBeenCalledWith(
      probes.web.url,
      expect.objectContaining({
        headers: {
          authorization: `Bearer ${"t".repeat(32)}`,
          "cache-control": "no-cache",
        },
        redirect: "error",
      })
    );
  });

  it.each(["wrong-version", "missing-check", "failed-check"])(
    "rejects %s before certification",
    async (failure) => {
      const { attempt, probes, versionId } = fixture();
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockResolvedValue(
          Response.json({
            checks:
              failure === "missing-check"
                ? {}
                : { ready: failure !== "failed-check" },
            versionId: failure === "wrong-version" ? randomUUID() : versionId,
          })
        )
      );
      await expect(
        observeRelease(attempt, probes, "t".repeat(32))
      ).rejects.toThrow("invalid result");
    }
  );

  it("cancels oversized chunked responses without reading the remainder", async () => {
    const { attempt, probes } = fixture();
    const cancel = vi.fn<() => void>();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      cancel,
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(4097));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(body))
    );
    await expect(
      observeRelease(attempt, probes, "t".repeat(32))
    ).rejects.toThrow("response limit");
    expect(cancel).toHaveBeenCalledOnce();
    expect(pulls).toBeLessThanOrEqual(2);
  });

  it("refuses missing coverage before making a request", async () => {
    const { attempt } = fixture();
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    await expect(observeRelease(attempt, {}, "t".repeat(32))).rejects.toThrow(
      "Every service"
    );
    expect(request).not.toHaveBeenCalled();
  });
});
