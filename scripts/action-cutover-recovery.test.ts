import { describe, expect, test } from "vite-plus/test";

import {
  actionEvidenceSchema,
  assertRecoveryContinuity,
  validateRecoveryProvenance,
} from "./action-cutover-recovery.ts";

const sourceCommit = "a".repeat(40);
const buildId = `${sourceCommit}-123-1`;
const verifiedAt = "2026-11-06T10:04:16.702Z";
const original = actionEvidenceSchema.parse({
  buildId,
  lambdas: ["mailInbound", "mailReceipt"].map((role) => ({
    arn: `arn:aws:lambda:eu-central-1:123456789012:function:${role}`,
    buildId,
    code: `${role}-code`,
    protocol: "personal-actions-v1",
    revision: `${role}-revision`,
    role,
    state: "Active",
    update: "Successful",
  })),
  protocol: "personal-actions-v1",
  sourceCommit,
  verifiedAt,
  workers: Object.entries({
    gmailMaintenance: "quieter-production-gmailpubsubmaintenancehandlerscript",
    gmailProcessing: "quieter-production-gmailprocessingworkerscript",
    gmailRealtime: "quieter-production-gmailrealtimeworkerscript",
    mailMaintenance: "quieter-production-mailmaintenancehandlerscript",
    "web-a": "quieter-production-web-release-a",
    "web-b": "quieter-production-web-release-b",
  }).map(([role, script]) => ({
    buildId,
    role,
    script,
    version: "11111111-1111-4111-8111-111111111111",
  })),
});
const fixture = {
  artifact: {
    created_at: "2026-11-06T10:15:45Z",
    digest: `sha256:${"b".repeat(64)}`,
    expired: false,
    id: 456,
    name: "action-cutover",
    workflow_run: { head_sha: sourceCommit, id: 123 },
  },
  attempt: 1,
  cutover: {
    pending: true,
    required: true,
    state: {
      buildId: sourceCommit,
      id: "personal-actions-v1",
      phase: "fenced",
      preparedAt: "2026-11-06T09:59:24Z",
      releasedAt: null,
      workflowIdentity: "123/1",
    },
  },
  evidence: original,
  jobs: {
    jobs: [
      {
        name: "Deploy production",
        run_attempt: 1,
        run_id: 123,
        status: "completed",
        steps: [
          "Prepare or assert durable personal Action cutover",
          "Apply production database migrations",
          "Deploy prepared build with SST",
          "Verify signed mail updates",
          "Verify production release",
          "Disable direct private release URLs",
          "Verify every deployed Action consumer",
          "Retain nonsecret cutover evidence",
        ].map((name) => ({
          completed_at: "2026-11-06T10:04:16Z",
          conclusion: "success",
          name,
          started_at: "2026-11-06T10:04:14Z",
        })),
      },
    ],
    total_count: 1,
  },
  now: Date.parse("2026-11-06T11:00:00Z"),
  run: {
    event: "workflow_dispatch",
    head_branch: "main",
    head_repository: { full_name: "quieter-email/quieter" },
    head_sha: sourceCommit,
    id: 123,
    path: ".github/workflows/sst-deploy.yml",
    run_attempt: 1,
    status: "completed",
    updated_at: "2026-11-06T10:15:50Z",
  },
  runId: 123,
};

describe("interrupted Action cutover recovery", () => {
  test("uses the original completed verification despite truncated GitHub timestamps", () => {
    const recovered = validateRecoveryProvenance(fixture);
    expect(recovered).toMatchObject({
      buildId,
      sourceCommit,
      workflowIdentity: "123/1",
    });
    const deadline = Date.parse(recovered.drainDeadline);
    expect(() =>
      validateRecoveryProvenance({ ...fixture, now: deadline - 1 })
    ).toThrow(/not elapsed/u);
    expect(() =>
      validateRecoveryProvenance({ ...fixture, now: deadline })
    ).not.toThrow();
  });

  test("rejects unrelated or incomplete deployment evidence", () => {
    const mutations: ((input: typeof fixture) => void)[] = [
      (input) => {
        input.run.head_branch = "feature";
      },
      (input) => {
        input.run.head_repository.full_name = "foreign/repo";
      },
      (input) => {
        input.run.path = ".github/workflows/other.yml";
      },
      (input) => {
        input.attempt = 2;
      },
      (input) => {
        input.artifact.workflow_run.id = 999;
      },
      (input) => {
        input.artifact.workflow_run.head_sha = "c".repeat(40);
      },
      (input) => {
        input.jobs.total_count = 2;
      },
      (input) => {
        input.evidence.verifiedAt = "2026-11-06T10:00:00Z";
      },
      (input) => {
        input.evidence.sourceCommit = "c".repeat(40);
      },
      (input) => {
        input.cutover.state.buildId = "c".repeat(40);
      },
      (input) => {
        input.cutover.state.phase = "ready";
      },
    ];
    for (const mutate of mutations) {
      const input = structuredClone(fixture);
      mutate(input);
      expect(() => validateRecoveryProvenance(input)).toThrow(Error);
    }
    const input = structuredClone(fixture);
    for (const job of input.jobs.jobs) {
      for (const step of job.steps) {
        if (step.name === "Verify every deployed Action consumer") {
          step.conclusion = "skipped";
        }
      }
    }
    expect(() => validateRecoveryProvenance(input)).toThrow(
      /did not complete/u
    );
  });

  test("requires the complete distinct consumer inventory", () => {
    const missing = structuredClone(fixture);
    missing.evidence.workers.pop();
    expect(() => validateRecoveryProvenance(missing)).toThrow(
      /every consumer/u
    );
    const duplicate = structuredClone(fixture);
    duplicate.evidence.workers = duplicate.evidence.workers.map((worker) => ({
      ...worker,
      role: "web-a",
    }));
    expect(() => validateRecoveryProvenance(duplicate)).toThrow(
      /every consumer/u
    );
    const redirected = structuredClone(fixture);
    redirected.evidence.lambdas = redirected.evidence.lambdas.map((lambda) => ({
      ...lambda,
      arn: "arn:aws:lambda:eu-central-1:123456789012:function:unrelated",
    }));
    expect(() => validateRecoveryProvenance(redirected)).toThrow(
      /every consumer/u
    );
  });

  test("retains the actual fence owner when the same source is redeployed", () => {
    const input = structuredClone(fixture);
    input.cutover.state.workflowIdentity = "99/2";
    expect(validateRecoveryProvenance(input).workflowIdentity).toBe("99/2");
  });

  test("preserves the verified compatible web predecessor", () => {
    const input = structuredClone(fixture);
    input.evidence.workers = input.evidence.workers.map((worker) => ({
      ...worker,
      buildId:
        worker.role === "web-b" ? `${"c".repeat(40)}-99-1` : worker.buildId,
    }));
    const recovered = validateRecoveryProvenance(input);
    const current = structuredClone(recovered.evidence);
    current.workers = current.workers.map((worker) => ({
      ...worker,
      deployedAt: "2026-11-06T10:03:57Z",
    }));
    expect(() => {
      assertRecoveryContinuity(recovered.evidence, current);
    }).not.toThrow();
    current.workers = current.workers.map((worker) => ({ ...worker, buildId }));
    expect(() => {
      assertRecoveryContinuity(recovered.evidence, current);
    }).toThrow(/changed during the drain/u);
    input.evidence.workers = input.evidence.workers.map((worker) => ({
      ...worker,
      buildId: "old-build",
    }));
    expect(() => validateRecoveryProvenance(input)).toThrow(/every consumer/u);
  });

  test("rejects rollback and restoration even when the active version is unchanged", () => {
    const current = structuredClone(original);
    current.workers = current.workers.map((worker) => ({
      ...worker,
      deployedAt: "2026-11-06T10:03:57Z",
    }));
    expect(() => {
      assertRecoveryContinuity(original, current);
    }).not.toThrow();
    current.workers = current.workers.map((worker) => ({
      ...worker,
      deployedAt: "2026-11-06T10:05:00Z",
    }));
    expect(() => {
      assertRecoveryContinuity(original, current);
    }).toThrow(/changed during the drain/u);
    expect(() => {
      assertRecoveryContinuity(original, original);
    }).toThrow(/changed during the drain/u);
  });

  test("rejects consumer changes after the original verification", () => {
    for (const field of ["version", "code", "revision"] as const) {
      const current = structuredClone(original);
      current.workers = current.workers.map((worker) => ({
        ...worker,
        deployedAt: "2026-11-06T10:03:57Z",
        ...(field === "version"
          ? { version: "22222222-2222-4222-8222-222222222222" }
          : {}),
      }));
      if (field !== "version") {
        current.lambdas = current.lambdas.map((lambda) => ({
          ...lambda,
          [field]: "changed",
        }));
      }
      expect(() => {
        assertRecoveryContinuity(original, current);
      }).toThrow(/changed during the drain/u);
    }
  });
});
