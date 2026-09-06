import type { z } from "zod";

import { planPromotion } from "./compatibility.ts";
import type {
  ActiveDeployment,
  Checkpoint,
  HealthyRelease,
  HealthEvidence,
  ReleaseAttempt,
  ReleaseJournal,
  ReleaseState,
  RuntimeProvider,
} from "./schema.ts";
import {
  healthyReleaseSchema,
  healthEvidenceSchema,
  probeConfigurationSchema,
} from "./schema.ts";

export class ReleaseController {
  readonly journal: ReleaseJournal;
  readonly provider: RuntimeProvider;
  readonly now: () => Date;
  private readonly preflight: {
    verify: (release: HealthyRelease) => Promise<void>;
  };
  private readonly health: {
    candidate: (attempt: ReleaseAttempt) => Promise<void>;
    recovered: (attempt: ReleaseAttempt) => Promise<void>;
  };

  constructor(
    journal: ReleaseJournal,
    provider: RuntimeProvider,
    preflight: { verify: (release: HealthyRelease) => Promise<void> },
    health: {
      candidate: (attempt: ReleaseAttempt) => Promise<void>;
      recovered: (attempt: ReleaseAttempt) => Promise<void>;
    },
    now = () => new Date()
  ) {
    this.journal = journal;
    this.provider = provider;
    this.now = now;
    this.preflight = preflight;
    this.health = health;
  }

  async prepare(input: {
    candidate: HealthyRelease;
    expectedBaseline?: HealthyRelease;
    id: string;
    mode?: "promote" | "rollback";
    probes: z.input<typeof probeConfigurationSchema>;
    workflowRunId: string;
  }) {
    const checkpoint = await this.requireState();
    const { state } = checkpoint;
    if (
      input.expectedBaseline !== undefined &&
      JSON.stringify(input.expectedBaseline) !== JSON.stringify(state.healthy)
    ) {
      throw new Error(
        "The healthy release changed after planning. Plan again."
      );
    }
    if (
      state.attempt &&
      !["healthy", "rolled_back"].includes(state.attempt.status)
    ) {
      throw new Error(
        "An unresolved release must be recovered before another attempt."
      );
    }
    const candidate = healthyReleaseSchema.parse(input.candidate);
    const probes = probeConfigurationSchema.parse(input.probes);
    if (
      candidate.services.some(
        (service) => !Object.hasOwn(probes, service.service)
      )
    ) {
      throw new Error(
        "Every release service requires protected health probes."
      );
    }
    if (
      input.mode === "rollback" &&
      !state.history.some(
        (release) => JSON.stringify(release) === JSON.stringify(candidate)
      )
    ) {
      throw new Error(
        "Manual rollback must select an exact retained healthy release."
      );
    }
    if (candidate.id === state.healthy.id) {
      throw new Error("The selected release is already healthy and active.");
    }
    const order = planPromotion(state.healthy, candidate);
    if (order.length === 0) {
      throw new Error("The release changes no runtime versions.");
    }
    await this.preflight.verify(state.healthy);
    await this.preflight.verify(candidate);
    for (const service of candidate.services) {
      if (state.quarantinedArtifacts.includes(service.artifactDigest)) {
        throw new Error("The release contains a quarantined artifact.");
      }
      // oxlint-disable-next-line no-await-in-loop -- Provider reads remain bounded and ordered.
      await this.provider.verifyVersion(service.scriptName, service.versionId);
    }
    const deployments: Record<string, ActiveDeployment> = {};
    for (const service of state.healthy.services) {
      // oxlint-disable-next-line no-await-in-loop -- Record the complete baseline before any mutation.
      const active = await this.provider.active(service.scriptName);
      if (active.versionId !== service.versionId) {
        throw new Error(
          "Production differs from the recorded healthy release. Reconcile drift first."
        );
      }
      // oxlint-disable-next-line no-await-in-loop -- Prove rollback versions still exist before promotion.
      await this.provider.verifyVersion(service.scriptName, service.versionId);
      deployments[service.service] = active;
    }
    const attempt: ReleaseAttempt = {
      activatedServices: [],
      baseline: state.healthy,
      candidate,
      deadline: new Date(this.now().getTime() + 10 * 60_000).toISOString(),
      deployments,
      failure: null,
      health: null,
      id: input.id,
      intent: null,
      mode: input.mode ?? "promote",
      observationStartedAt: null,
      order,
      probes,
      status: "prepared",
      workflowRunId: input.workflowRunId,
    };
    return await this.journal.write(checkpoint.revision, { ...state, attempt });
  }

  async promote(id: string) {
    let checkpoint = await this.requireAttempt(id);
    if (
      !checkpoint.state.attempt ||
      !["prepared", "promoting"].includes(checkpoint.state.attempt.status)
    ) {
      throw new Error("This attempt is not eligible for promotion.");
    }
    await this.preflight.verify(checkpoint.state.attempt.baseline);
    await this.preflight.verify(checkpoint.state.attempt.candidate);
    await this.health.candidate(checkpoint.state.attempt);
    await this.assertExpectedMap(checkpoint);
    for (const name of checkpoint.state.attempt.order) {
      // oxlint-disable-next-line no-await-in-loop -- Pointer changes must follow the proven contract order.
      checkpoint = await this.move(checkpoint, name, false);
    }
    return await this.updateAttempt(checkpoint, {
      observationStartedAt: this.now().toISOString(),
      status: "observing",
    });
  }

  async certify(id: string, evidence: HealthEvidence) {
    const checkpoint = await this.requireAttempt(id);
    const { state } = checkpoint;
    const { attempt } = state;
    if (!attempt || attempt.status !== "observing" || attempt.intent) {
      throw new Error(
        "Only an observed release with settled mutations can be certified."
      );
    }
    if (this.now().getTime() > new Date(attempt.deadline).getTime()) {
      throw new Error(
        "Release health deadline expired. Recover before continuing."
      );
    }
    const health = healthEvidenceSchema.parse(evidence);
    if (
      health.attemptId !== id ||
      attempt.observationStartedAt === null ||
      Date.parse(health.startedAt) < Date.parse(attempt.observationStartedAt) ||
      Date.parse(health.finishedAt) - Date.parse(health.startedAt) < 120_000 ||
      Date.parse(health.finishedAt) > this.now().getTime() ||
      this.now().getTime() - Date.parse(health.finishedAt) > 30_000 ||
      attempt.candidate.services.some(
        (service) =>
          health.services[service.service]?.versionId !== service.versionId
      )
    ) {
      throw new Error(
        "Release health evidence is missing, stale, or does not cover the complete candidate."
      );
    }
    await this.assertActive(checkpoint, attempt.candidate);
    return await this.journal.write(checkpoint.revision, {
      ...state,
      attempt: { ...attempt, health, status: "healthy" },
      healthy: attempt.candidate,
      history: [...state.history, state.healthy].slice(-100),
    });
  }

  async recover(id: string, reason: string) {
    let checkpoint = await this.requireAttempt(id);
    let { attempt } = checkpoint.state;
    if (!attempt) {
      throw new Error("Release attempt missing.");
    }
    if (attempt.status === "rolled_back") {
      return checkpoint;
    }
    if (attempt.status === "healthy") {
      throw new Error(
        "A healthy release requires a new approved rollback attempt."
      );
    }
    await this.assertExpectedMap(checkpoint);
    checkpoint = await this.updateAttempt(checkpoint, {
      failure: reason,
      status: "recovering",
    });
    ({ attempt } = checkpoint.state);
    if (!attempt) {
      throw new Error("Release attempt missing.");
    }
    for (const name of attempt.order.toReversed()) {
      // oxlint-disable-next-line no-await-in-loop -- Undo the compatible prefix in reverse order.
      checkpoint = await this.move(checkpoint, name, true);
    }
    await this.assertActive(checkpoint, attempt.baseline);
    const current = checkpoint.state.attempt;
    if (!current) {
      throw new Error("Release attempt missing.");
    }
    await this.health.recovered(current);
    await this.assertActive(checkpoint, attempt.baseline);
    return await this.journal.write(checkpoint.revision, {
      ...checkpoint.state,
      attempt: { ...current, intent: null, status: "rolled_back" },
      quarantinedArtifacts: [
        ...new Set([
          ...checkpoint.state.quarantinedArtifacts,
          ...attempt.candidate.services
            .filter((service) =>
              current.activatedServices.includes(service.service)
            )
            .map((service) => service.artifactDigest),
        ]),
      ],
    });
  }

  private async move(
    initialCheckpoint: Checkpoint,
    name: string,
    rollback: boolean
  ): Promise<Checkpoint> {
    let checkpoint = initialCheckpoint;
    const { attempt } = checkpoint.state;
    if (!attempt) {
      throw new Error("Release attempt missing.");
    }
    if (
      !rollback &&
      this.now().getTime() > new Date(attempt.deadline).getTime()
    ) {
      throw new Error("Release deadline expired.");
    }
    const target = (
      rollback ? attempt.baseline : attempt.candidate
    ).services.find((service) => service.service === name);
    const candidate = attempt.candidate.services.find(
      (service) => service.service === name
    );
    const baseline = attempt.baseline.services.find(
      (service) => service.service === name
    );
    if (!target || !candidate || !baseline) {
      throw new Error("Unknown release service.");
    }
    const actual = await this.provider.active(target.scriptName);
    const expected = attempt.deployments[name];
    const pending = attempt.intent?.service === name ? attempt.intent : null;
    if (
      pending &&
      actual.versionId === pending.targetVersionId &&
      actual.id !== pending.expected.id
    ) {
      checkpoint = await this.updateAttempt(checkpoint, {
        activatedServices: [
          ...new Set([
            ...attempt.activatedServices,
            ...(actual.versionId === candidate.versionId ? [name] : []),
          ]),
        ],
        deployments: { ...attempt.deployments, [name]: actual },
        intent: null,
      });
    } else if (
      expected === undefined ||
      actual.id !== expected.id ||
      actual.versionId !== expected.versionId
    ) {
      await this.updateAttempt(checkpoint, {
        failure: "unexpected_deployment",
        status: "blocked",
      });
      throw new Error(
        "Unexpected provider deployment. Refusing to overwrite external changes."
      );
    }
    if (actual.versionId === target.versionId) {
      return checkpoint;
    }
    if (rollback && actual.versionId === candidate.versionId) {
      const current = checkpoint.state.attempt;
      if (!current) {
        throw new Error("Release attempt missing.");
      }
      checkpoint = await this.updateAttempt(checkpoint, {
        activatedServices: [...new Set([...current.activatedServices, name])],
      });
    }
    if (
      actual.versionId !== (rollback ? candidate.versionId : baseline.versionId)
    ) {
      throw new Error("The active runtime is outside this release.");
    }
    await this.provider.verifyVersion(target.scriptName, target.versionId);
    await this.assertExpectedMap(checkpoint);
    checkpoint = await this.updateAttempt(checkpoint, {
      intent: {
        expected: actual,
        service: name,
        targetVersionId: target.versionId,
      },
      status: rollback ? "recovering" : "promoting",
    });
    const fresh = await this.requireAttempt(attempt.id);
    const before = await this.provider.active(target.scriptName);
    if (
      fresh.revision !== checkpoint.revision ||
      before.id !== actual.id ||
      before.versionId !== actual.versionId
    ) {
      throw new Error("Release ownership changed before activation.");
    }
    // Do not catch or retry an ambiguous mutation. Its persisted intent is recovered separately.
    await this.provider.activate(target.scriptName, target.versionId);
    const observed = await this.provider.active(target.scriptName);
    if (observed.versionId !== target.versionId || observed.id === actual.id) {
      throw new Error("Provider activation has not been confirmed.");
    }
    const latest = checkpoint.state.attempt;
    if (!latest) {
      throw new Error("Release attempt missing.");
    }
    return await this.updateAttempt(checkpoint, {
      activatedServices: [
        ...new Set([...latest.activatedServices, ...(rollback ? [] : [name])]),
      ],
      deployments: { ...latest.deployments, [name]: observed },
      intent: null,
    });
  }

  private async assertActive(checkpoint: Checkpoint, release: HealthyRelease) {
    for (const service of release.services) {
      // oxlint-disable-next-line no-await-in-loop -- Verify the entire map, including unchanged services.
      const active = await this.provider.active(service.scriptName);
      const expected = checkpoint.state.attempt?.deployments[service.service];
      if (
        active.versionId !== service.versionId ||
        active.id !== expected?.id
      ) {
        throw new Error(
          "The provider does not match the expected complete release map."
        );
      }
    }
  }

  private async assertExpectedMap(checkpoint: Checkpoint) {
    const { attempt } = checkpoint.state;
    if (!attempt) {
      throw new Error("Release attempt missing.");
    }
    for (const service of attempt.baseline.services) {
      // oxlint-disable-next-line no-await-in-loop -- Stop before touching any service when the complete map has drifted.
      const actual = await this.provider.active(service.scriptName);
      const expected = attempt.deployments[service.service];
      const intent =
        attempt.intent?.service === service.service ? attempt.intent : null;
      const matchesExpected =
        actual.id === expected?.id && actual.versionId === expected.versionId;
      const matchesIntent =
        intent &&
        actual.versionId === intent.targetVersionId &&
        actual.id !== intent.expected.id;
      if (!matchesExpected && matchesIntent !== true) {
        // oxlint-disable-next-line no-await-in-loop -- Persist drift before refusing further mutation.
        await this.updateAttempt(checkpoint, {
          failure: "unexpected_deployment",
          status: "blocked",
        });
        throw new Error(
          "Unexpected provider deployment. Refusing to overwrite external changes."
        );
      }
    }
  }

  private async requireState() {
    const checkpoint = await this.journal.read();
    if (!checkpoint) {
      throw new Error("Release history must be bootstrapped before mutation.");
    }
    return checkpoint;
  }

  private async requireAttempt(id: string) {
    const checkpoint = await this.requireState();
    if (checkpoint.state.attempt?.id !== id) {
      throw new Error("This attempt has been superseded or does not exist.");
    }
    return checkpoint;
  }

  private async updateAttempt(
    checkpoint: Checkpoint,
    changes: Partial<ReleaseAttempt>
  ) {
    if (!checkpoint.state.attempt) {
      throw new Error("Release attempt missing.");
    }
    const state: ReleaseState = {
      ...checkpoint.state,
      attempt: { ...checkpoint.state.attempt, ...changes },
    };
    return await this.journal.write(checkpoint.revision, state);
  }
}
