import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vite-plus/test";

import { reconcileRelease } from "../src/recovery.ts";
import type { Checkpoint, ReleaseJournal } from "../src/schema.ts";

const fixture = () => {
  const release = {
    id: "baseline",
    services: [
      {
        artifactDigest: "a".repeat(64),
        bindingGeneration: "b".repeat(64),
        contracts: [],
        requirements: {},
        scriptName: "proof",
        service: "web",
        versionId: randomUUID(),
      },
    ],
    sourceSha: "c".repeat(40),
  };
  const checkpoint: Checkpoint = {
    revision: "1",
    state: {
      attempt: {
        activatedServices: [],
        baseline: release,
        candidate: { ...release, id: "candidate" },
        deadline: "2026-09-06T12:10:00Z",
        deployments: {},
        failure: null,
        health: null,
        id: "attempt",
        intent: null,
        mode: "promote",
        observationStartedAt: null,
        order: ["web"],
        status: "promoting",
        workflowRunId: "42",
      },
      healthy: release,
      history: [],
      quarantinedArtifacts: [],
      schemaVersion: 1,
      stage: "release-proof-test",
    },
  };
  const controller = {
    journal: {
      read: vi.fn<ReleaseJournal["read"]>().mockResolvedValue(checkpoint),
      write: vi.fn<ReleaseJournal["write"]>(),
    },
    now: () => new Date("2026-09-06T12:00:00Z"),
    recover: vi
      .fn<(id: string, reason: string) => Promise<Checkpoint>>()
      .mockResolvedValue(checkpoint),
  };
  return {
    checkpoint,
    controller,
    input: { repository: "quieter-email/quieter", token: "read-workflow" },
    run: {
      head_branch: "main",
      id: 42,
      path: ".github/workflows/release-runtime.yml",
      repository: { full_name: "quieter-email/quieter" },
      status: "completed",
    },
  };
};

describe("independent release recovery", () => {
  it("recovers an unfinished attempt even when its writer reports success", async () => {
    const { controller, input, run } = fixture();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ...run, conclusion: "success" }));
    await expect(reconcileRelease(controller, input, request)).resolves.toBe(
      "recovered"
    );
    expect(controller.recover).toHaveBeenCalledWith("attempt", "writer_ended");
  });

  it("ignores obsolete completion events without reading another writer", async () => {
    const { controller, input } = fixture();
    const request = vi.fn<typeof fetch>();
    await expect(
      reconcileRelease(controller, { ...input, eventRunId: "41" }, request)
    ).resolves.toBe("stale_event");
    expect(request).not.toHaveBeenCalled();
    expect(controller.recover).not.toHaveBeenCalled();
  });

  it.each(["in_progress", "queued", "waiting"])(
    "does not race a %s writer",
    async (status) => {
      const { controller, input, run } = fixture();
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ ...run, status }));
      await expect(reconcileRelease(controller, input, request)).resolves.toBe(
        "writer_active"
      );
      expect(controller.recover).not.toHaveBeenCalled();
    }
  );

  it("reports an expired active writer without attempting compensation", async () => {
    const { controller, input, run } = fixture();
    controller.now = () => new Date("2026-09-06T12:11:00Z");
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ...run, status: "in_progress" }));
    await expect(reconcileRelease(controller, input, request)).rejects.toThrow(
      "writer is still active"
    );
    expect(controller.recover).not.toHaveBeenCalled();
  });

  it.each(["fork", "pull-request", "wrong-run", "unavailable"])(
    "refuses recovery from %s evidence",
    async (failure) => {
      const { controller, input, run } = fixture();
      const response =
        failure === "unavailable"
          ? new Response(null, { status: 503 })
          : Response.json({
              ...run,
              head_branch: failure === "pull-request" ? "feature" : "main",
              id: failure === "wrong-run" ? 43 : 42,
              repository: {
                full_name:
                  failure === "fork" ? "someone/quieter" : input.repository,
              },
            });
      const request = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(
        reconcileRelease(controller, input, request)
      ).rejects.toThrow(/writer status|recorded release writer|Invalid input/u);
      expect(controller.recover).not.toHaveBeenCalled();
    }
  );
});
