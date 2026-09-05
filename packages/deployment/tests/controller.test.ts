/* oxlint-disable require-await, max-classes-per-file, class-methods-use-this, no-await-expression-member -- In-memory provider and journal implement the production asynchronous interfaces. */
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import { planPromotion } from "../src/compatibility.ts";
import { ReleaseController } from "../src/controller.ts";
import { releaseStateSchema } from "../src/schema.ts";
import type {
  ActiveDeployment,
  Checkpoint,
  ReleaseJournal,
  ReleaseState,
  RuntimeProvider,
  ServiceVersion,
} from "../src/schema.ts";

class Journal implements ReleaseJournal {
  checkpoint: Checkpoint | null = null;
  writes = 0;
  failAt = -1;

  async read() {
    return structuredClone(this.checkpoint);
  }

  async write(revision: string | null, state: ReleaseState) {
    if (revision !== (this.checkpoint?.revision ?? null)) {
      throw new Error("Concurrent journal write.");
    }
    this.writes += 1;
    if (this.writes === this.failAt) {
      throw new Error("Runner stopped during journal write.");
    }
    this.checkpoint = {
      revision: String(this.writes),
      state: releaseStateSchema.parse(structuredClone(state)),
    };
    return structuredClone(this.checkpoint);
  }
}

class Provider implements RuntimeProvider {
  deployments = new Map<string, ActiveDeployment>();
  calls: string[] = [];
  failAfterMutation = false;
  failBeforeMutation = false;

  async active(scriptName: string) {
    const deployment = this.deployments.get(scriptName);
    if (!deployment) {
      throw new Error("Missing Worker.");
    }
    return structuredClone(deployment);
  }

  async activate(scriptName: string, versionId: string) {
    if (this.failBeforeMutation) {
      throw new Error("Provider unavailable.");
    }
    this.calls.push(scriptName);
    this.deployments.set(scriptName, { id: randomUUID(), versionId });
    if (this.failAfterMutation) {
      throw new Error("Provider accepted mutation but the response was lost.");
    }
  }

  async verifyVersion(_scriptName: string, _versionId: string) {
    await Promise.resolve();
  }
}

const fixture = async () => {
  const services: ServiceVersion[] = [
    "backend",
    "frontend",
  ].map<ServiceVersion>((service) => ({
    artifactDigest: "a".repeat(64),
    bindingGeneration: "b".repeat(64),
    contracts: ["v1"],
    requirements: Object.fromEntries(
      service === "frontend" ? [["backend", ["v1"]]] : []
    ),
    scriptName: `test-${service}`,
    service,
    versionId: randomUUID(),
  }));
  const baseline = { id: "baseline", services, sourceSha: "a".repeat(40) };
  const candidate = {
    id: "candidate",
    services: services.map<ServiceVersion>((service) => ({
      ...structuredClone(service),
      artifactDigest: "c".repeat(64),
      versionId: randomUUID(),
    })),
    sourceSha: "b".repeat(40),
  };
  const journal = new Journal();
  await journal.write(null, {
    attempt: null,
    healthy: baseline,
    history: [],
    quarantinedArtifacts: [],
    schemaVersion: 1,
    stage: "test",
  });
  const provider = new Provider();
  for (const service of services) {
    provider.deployments.set(service.scriptName, {
      id: randomUUID(),
      versionId: service.versionId,
    });
  }
  let time = Date.now();
  const controller = new ReleaseController(
    journal,
    provider,
    () => new Date(time)
  );
  return {
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
    baseline,
    candidate,
    controller,
    journal,
    provider,
  };
};

describe("durable runtime release recovery", () => {
  it("promotes the complete group and certifies only after observation", async () => {
    const { candidate, controller, journal, provider, advance } =
      await fixture();
    await controller.prepare({ candidate, id: "attempt", workflowRunId: "1" });
    const health = {
      attemptId: "attempt",
      finishedAt: new Date(controller.now().getTime() + 120_000).toISOString(),
      services: Object.fromEntries(
        candidate.services.map((service) => [
          service.service,
          { failures: 0 as const, samples: 13, versionId: service.versionId },
        ])
      ),
      startedAt: controller.now().toISOString(),
    };
    await expect(controller.certify("attempt", health)).rejects.toThrow(
      "observed"
    );
    await controller.promote("attempt");
    expect(journal.checkpoint?.state.healthy.id).toBe("baseline");
    advance(120_000);
    await controller.certify("attempt", health);
    expect(provider.calls).toStrictEqual(["test-backend", "test-frontend"]);
    expect(journal.checkpoint?.state.healthy.id).toBe("candidate");
    expect(journal.checkpoint?.state.history[0].id).toBe("baseline");
  });

  it("recovers a lost activation response using a new controller", async () => {
    const { baseline, candidate, controller, journal, provider } =
      await fixture();
    await controller.prepare({ candidate, id: "attempt", workflowRunId: "1" });
    provider.failAfterMutation = true;
    await expect(controller.promote("attempt")).rejects.toThrow(
      "response was lost"
    );
    expect(journal.checkpoint?.state.attempt?.intent?.service).toBe("backend");
    provider.failAfterMutation = false;
    await new ReleaseController(journal, provider).recover(
      "attempt",
      "runner_lost"
    );
    expect((await provider.active("test-backend")).versionId).toBe(
      baseline.services[0].versionId
    );
    expect(provider.calls).toStrictEqual(["test-backend", "test-backend"]);
    expect(journal.checkpoint?.state.attempt?.status).toBe("rolled_back");
  });

  it.each([3, 4, 5, 6, 7])(
    "recovers process termination at journal write %i",
    async (failAt) => {
      const { baseline, candidate, controller, journal, provider } =
        await fixture();
      await controller.prepare({
        candidate,
        id: "attempt",
        workflowRunId: "1",
      });
      journal.failAt = failAt;
      await expect(controller.promote("attempt")).rejects.toThrow(
        "Runner stopped"
      );
      journal.failAt = -1;
      await new ReleaseController(journal, provider).recover(
        "attempt",
        "runner_lost"
      );
      for (const service of baseline.services) {
        // oxlint-disable-next-line no-await-in-loop -- Assert each persisted provider pointer after recovery.
        expect((await provider.active(service.scriptName)).versionId).toBe(
          service.versionId
        );
      }
      expect(journal.checkpoint?.state.attempt?.status).toBe("rolled_back");
    }
  );

  it("never mutates a newer deployment when an old alarm arrives", async () => {
    const { candidate, controller, provider } = await fixture();
    await controller.prepare({ candidate, id: "attempt", workflowRunId: "1" });
    await controller.promote("attempt");
    const unrelated = { id: randomUUID(), versionId: randomUUID() };
    provider.deployments.set("test-frontend", unrelated);
    await expect(controller.recover("attempt", "gate_failed")).rejects.toThrow(
      "Unexpected provider deployment"
    );
    await expect(provider.active("test-frontend")).resolves.toStrictEqual(
      unrelated
    );
    expect(provider.calls).toHaveLength(2);
  });

  it("keeps a failed rollback recoverable and prevents a new release", async () => {
    const { candidate, controller, journal, provider } = await fixture();
    await controller.prepare({ candidate, id: "attempt", workflowRunId: "1" });
    await controller.promote("attempt");
    provider.failBeforeMutation = true;
    await expect(controller.recover("attempt", "gate_failed")).rejects.toThrow(
      "Provider unavailable"
    );
    expect(journal.checkpoint?.state.attempt?.status).toBe("recovering");
    await expect(
      controller.prepare({ candidate, id: "next", workflowRunId: "2" })
    ).rejects.toThrow("unresolved");
    provider.failBeforeMutation = false;
    await controller.recover("attempt", "recovery_retry");
    expect(journal.checkpoint?.state.attempt?.status).toBe("rolled_back");
  });

  it("quarantines the rejected artifacts and ignores superseded attempt IDs", async () => {
    const { candidate, controller } = await fixture();
    await controller.prepare({ candidate, id: "attempt", workflowRunId: "1" });
    await controller.recover("attempt", "gate_failed");
    await expect(
      controller.prepare({ candidate, id: "retry", workflowRunId: "2" })
    ).rejects.toThrow("quarantined");
    await expect(controller.recover("old", "old_alarm")).rejects.toThrow(
      "superseded"
    );
  });

  it("rejects incompatible binding and emitted-contract rollback boundaries", async () => {
    const { baseline, candidate } = await fixture();
    candidate.services[1].requirements = { backend: ["v2"] };
    candidate.services[0].contracts.push("v2");
    expect(() => planPromotion(baseline, candidate)).toThrow(
      "Unsupported contract"
    );
    candidate.services[1].requirements = { backend: ["v1"] };
    candidate.services[0].bindingGeneration = "d".repeat(64);
    expect(() => planPromotion(baseline, candidate)).toThrow(
      "binding generations"
    );
  });

  it("rejects a stale checkpoint even without provider compare-and-set", async () => {
    const { journal } = await fixture();
    const first = await journal.read();
    if (!first) {
      throw new Error("Missing initial state.");
    }
    await journal.write(first.revision, first.state);
    await expect(journal.write(first.revision, first.state)).rejects.toThrow(
      "Concurrent journal write"
    );
  });
});
