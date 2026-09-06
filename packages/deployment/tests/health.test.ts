/* oxlint-disable require-await -- Fetch stubs must return fresh response streams through the asynchronous API. */
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { observeRelease, verifyReleaseHealth } from "../src/health.ts";
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
    activatedServices: ["web"],
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
    probes: {
      web: {
        baselineUrl: "https://baseline.example/health",
        candidateUrl: "https://candidate.example/health",
        checks: ["ready"],
        url: "https://probe.example/health",
      },
    },
    versionId,
  };
};

describe("release health observation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each(["candidateUrl", "url"] as const)(
    "checks exact versions three times through %s",
    async (target) => {
      const { attempt, probes, versionId } = fixture();
      // oxlint-disable-next-line require-await -- Each sample must receive a fresh response stream.
      const request = vi
        .fn<typeof fetch>()
        .mockImplementation(async () =>
          Response.json({ checks: { ready: true }, versionId })
        );
      vi.stubGlobal("fetch", request);
      const pause = vi
        .fn<(milliseconds: number) => Promise<void>>()
        .mockResolvedValue();
      await verifyReleaseHealth(
        attempt.candidate,
        probes,
        "t".repeat(32),
        target,
        pause
      );
      expect(request.mock.calls.map(([url]) => url)).toStrictEqual(
        Array.from({ length: 3 }, () => probes.web[target])
      );
      expect(pause.mock.calls).toStrictEqual([[10_000], [10_000]]);
    }
  );

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

  it.each(["wrong-version", "missing-check"])(
    "rejects %s before certification",
    async (failure) => {
      const { attempt, probes, versionId } = fixture();
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockResolvedValue(
          Response.json({
            checks: failure === "missing-check" ? {} : { ready: true },
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

  it.each(["transient", "regression", "shared-outage", "critical"] as const)(
    "handles %s without falsely certifying health",
    async (scenario) => {
      vi.useFakeTimers();
      const { attempt, probes, versionId } = fixture();
      attempt.baseline = {
        ...attempt.baseline,
        services: attempt.baseline.services.map((service) => ({
          ...service,
          versionId: randomUUID(),
        })),
      };
      if (scenario === "shared-outage") {
        attempt.deadline = new Date(Date.now() + 50_000).toISOString();
      }
      let candidateRequests = 0;
      let baselineRequests = 0;
      // oxlint-disable-next-line require-await -- Each probe needs a fresh response body.
      const request = vi.fn<typeof fetch>().mockImplementation(async (url) => {
        const baseline = url === probes.web.baselineUrl;
        if (baseline) {
          baselineRequests += 1;
        } else {
          candidateRequests += 1;
        }
        const ready = baseline
          ? scenario !== "shared-outage"
          : scenario === "transient" && candidateRequests > 1;
        return Response.json({
          checks: { ready },
          versionId: baseline
            ? attempt.baseline.services[0].versionId
            : versionId,
        });
      });
      vi.stubGlobal("fetch", request);
      const observation = observeRelease(
        attempt,
        {
          web: {
            ...probes.web,
            criticalChecks: scenario === "critical" ? ["ready"] : [],
          },
        },
        "t".repeat(32),
        // oxlint-disable-next-line require-await -- Advance the simulated observation clock.
        async (milliseconds) => {
          vi.setSystemTime(Date.now() + milliseconds);
        }
      );
      const outcome = await observation.then(
        (evidence) => ({
          duration:
            Date.parse(evidence.finishedAt) - Date.parse(evidence.startedAt),
          error: null,
        }),
        (error: unknown) => ({
          duration: null,
          error: error instanceof Error ? error.message : "Unexpected failure",
        })
      );
      const expected = {
        critical: {
          baselineRequests: 0,
          candidateRequests: 1,
          duration: null,
          error: "A critical release safety check failed.",
        },
        regression: {
          baselineRequests: 3,
          candidateRequests: 3,
          duration: null,
          error:
            "Confirmed release regression for web: three consecutive failures with a healthy baseline.",
        },
        "shared-outage": {
          baselineRequests: 5,
          candidateRequests: 5,
          duration: null,
          error:
            "Health observation exceeded the release deadline without a healthy window.",
        },
        transient: {
          baselineRequests: 1,
          candidateRequests: 14,
          duration: 120_000,
          error: null,
        },
      };
      expect({ ...outcome, baselineRequests, candidateRequests }).toStrictEqual(
        expected[scenario]
      );
    }
  );

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
