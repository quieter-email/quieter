import { PERSONAL_ACTION_PROTOCOL } from "@quieter/env/deployment";
import { z } from "zod";

const timestamp = z.iso.datetime({ offset: true });
const workerSchema = z.object({
  buildId: z.string().min(1),
  deployedAt: timestamp.optional(),
  role: z.enum([
    "gmailMaintenance",
    "gmailProcessing",
    "gmailRealtime",
    "mailMaintenance",
    "web-a",
    "web-b",
  ]),
  script: z.string().regex(/^[\w-]+$/u),
  version: z.uuid(),
});
export const actionEvidenceSchema = z.object({
  buildId: z.string().min(1),
  lambdas: z.array(
    z.object({
      arn: z.string().regex(/^arn:aws:lambda:[\w-]+:\d{12}:function:[\w-]+$/u),
      buildId: z.string().min(1),
      code: z.string().min(1),
      protocol: z.literal(PERSONAL_ACTION_PROTOCOL),
      revision: z.string().min(1),
      role: z.enum(["mailInbound", "mailReceipt"]),
      state: z.literal("Active"),
      update: z.literal("Successful"),
    })
  ),
  protocol: z.literal(PERSONAL_ACTION_PROTOCOL),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  verifiedAt: timestamp,
  workers: z.array(workerSchema),
});
export type ActionEvidence = z.infer<typeof actionEvidenceSchema>;

const runSchema = z.object({
  event: z.literal("workflow_dispatch"),
  head_branch: z.literal("main"),
  head_repository: z.object({ full_name: z.literal("quieter-email/quieter") }),
  head_sha: actionEvidenceSchema.shape.sourceCommit,
  id: z.number().int().positive(),
  path: z.literal(".github/workflows/sst-deploy.yml"),
  run_attempt: z.number().int().positive(),
  status: z.literal("completed"),
  updated_at: timestamp,
});
const jobsSchema = z.object({
  jobs: z.array(
    z.object({
      name: z.string(),
      run_attempt: z.number().int().positive(),
      run_id: z.number().int().positive(),
      status: z.string(),
      steps: z.array(
        z.object({
          completed_at: timestamp.nullable(),
          conclusion: z.string().nullable(),
          name: z.string(),
          started_at: timestamp.nullable(),
        })
      ),
    })
  ),
  total_count: z.number().int().nonnegative(),
});
export const recoveryArtifactSchema = z.object({
  created_at: timestamp,
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  expired: z.literal(false),
  id: z.number().int().positive(),
  name: z.literal("action-cutover"),
  workflow_run: z.object({
    head_sha: actionEvidenceSchema.shape.sourceCommit,
    id: z.number().int().positive(),
  }),
});

export const validateRecoveryProvenance = (input: {
  artifact: unknown;
  attempt: number;
  cutover: unknown;
  evidence: unknown;
  jobs: unknown;
  now: number;
  run: unknown;
  runId: number;
}) => {
  const run = runSchema.parse(input.run);
  const jobs = jobsSchema.parse(input.jobs);
  const evidence = actionEvidenceSchema.parse(input.evidence);
  const artifact = recoveryArtifactSchema.parse(input.artifact);
  const { state: fence } = z
    .object({
      pending: z.literal(true),
      required: z.literal(true),
      state: z.object({
        buildId: actionEvidenceSchema.shape.sourceCommit,
        id: z.literal(PERSONAL_ACTION_PROTOCOL),
        phase: z.literal("fenced"),
        preparedAt: timestamp,
        releasedAt: z.null(),
        workflowIdentity: z.string().regex(/^[1-9]\d*\/[1-9]\d*$/u),
      }),
    })
    .parse(input.cutover);
  if (
    run.id !== input.runId ||
    run.run_attempt !== input.attempt ||
    artifact.workflow_run.id !== run.id ||
    artifact.workflow_run.head_sha !== run.head_sha ||
    jobs.total_count !== jobs.jobs.length
  ) {
    throw new Error(
      "Original deployment provenance does not match the requested attempt"
    );
  }
  const deployments = jobs.jobs.filter(
    (job) => job.name === "Deploy production"
  );
  const [deployment] = deployments;
  if (
    deployments.length !== 1 ||
    deployment?.run_id !== run.id ||
    deployment.run_attempt !== run.run_attempt ||
    deployment.status !== "completed"
  ) {
    throw new Error(
      "Original production deployment job is incomplete or ambiguous"
    );
  }
  const requiredSteps = [
    "Prepare or assert durable personal Action cutover",
    "Apply production database migrations",
    "Deploy prepared build with SST",
    "Verify signed mail updates",
    "Verify production release",
    "Disable direct private release URLs",
    "Verify every deployed Action consumer",
    "Retain nonsecret cutover evidence",
  ];
  for (const name of requiredSteps) {
    const steps = deployment.steps.filter((step) => step.name === name);
    if (
      steps.length !== 1 ||
      steps[0]?.conclusion !== "success" ||
      steps[0].completed_at === null
    ) {
      throw new Error(`Original deployment did not complete ${name}`);
    }
  }
  const verification = deployment.steps.find(
    (step) => step.name === "Verify every deployed Action consumer"
  );
  const verifiedAt = Date.parse(evidence.verifiedAt);
  if (
    !verification?.started_at ||
    !verification.completed_at ||
    verifiedAt < Date.parse(verification.started_at) ||
    verifiedAt >= Date.parse(verification.completed_at) + 1000 ||
    Date.parse(artifact.created_at) < verifiedAt ||
    Date.parse(artifact.created_at) >= Date.parse(run.updated_at) + 1000
  ) {
    throw new Error("Original verification evidence has invalid timing");
  }
  const buildId = `${run.head_sha}-${run.id}-${run.run_attempt}`;
  const workerIdentities = {
    gmailMaintenance: "quieter-production-gmailpubsubmaintenancehandlerscript",
    gmailProcessing: "quieter-production-gmailprocessingworkerscript",
    gmailRealtime: "quieter-production-gmailrealtimeworkerscript",
    mailMaintenance: "quieter-production-mailmaintenancehandlerscript",
    "web-a": "quieter-production-web-release-a",
    "web-b": "quieter-production-web-release-b",
  };
  if (
    evidence.sourceCommit !== run.head_sha ||
    fence.buildId !== run.head_sha ||
    Date.parse(fence.preparedAt) > verifiedAt ||
    evidence.buildId !== buildId ||
    evidence.workers.length !== Object.keys(workerIdentities).length ||
    new Set(evidence.workers.map((worker) => worker.role)).size !==
      Object.keys(workerIdentities).length ||
    evidence.workers.some(
      (worker) =>
        (worker.buildId !== buildId &&
          worker.role !== "web-a" &&
          worker.role !== "web-b") ||
        worker.script !== workerIdentities[worker.role]
    ) ||
    evidence.workers.filter((worker) => worker.buildId !== buildId).length >
      1 ||
    evidence.lambdas.length !== 2 ||
    new Set(evidence.lambdas.map((lambda) => lambda.role)).size !== 2 ||
    new Set(evidence.lambdas.map((lambda) => lambda.arn)).size !== 2 ||
    evidence.lambdas.some((lambda) => lambda.buildId !== buildId)
  ) {
    throw new Error(
      "Original evidence does not identify every consumer of the exact initial build"
    );
  }
  const drainDeadline =
    Math.max(verifiedAt, Date.parse(verification.completed_at)) + 960_000;
  if (input.now < drainDeadline) {
    throw new Error(
      `The original drain has not elapsed. Retry after ${new Date(drainDeadline).toISOString()}. Recovery does not wait.`
    );
  }
  return {
    artifact,
    buildId,
    drainDeadline: new Date(drainDeadline).toISOString(),
    evidence,
    sourceCommit: run.head_sha,
    workflowIdentity: fence.workflowIdentity,
  };
};

export const assertRecoveryContinuity = (
  original: ActionEvidence,
  current: ActionEvidence
) => {
  if (
    original.buildId !== current.buildId ||
    original.sourceCommit !== current.sourceCommit ||
    original.workers.length !== current.workers.length ||
    original.lambdas.length !== current.lambdas.length ||
    new Set(current.workers.map((worker) => worker.role)).size !==
      current.workers.length ||
    new Set(current.lambdas.map((lambda) => lambda.role)).size !==
      current.lambdas.length
  ) {
    throw new Error(
      "Action consumer inventory changed after the original verification"
    );
  }
  for (const worker of original.workers) {
    const deployed = current.workers.find((item) => item.role === worker.role);
    if (
      deployed?.script !== worker.script ||
      deployed.version !== worker.version ||
      deployed.buildId !== worker.buildId ||
      deployed.deployedAt === undefined ||
      Date.parse(deployed.deployedAt) > Date.parse(original.verifiedAt)
    ) {
      throw new Error(
        `Action consumer ${worker.role} changed during the drain`
      );
    }
  }
  for (const lambda of original.lambdas) {
    const deployed = current.lambdas.find((item) => item.role === lambda.role);
    if (
      deployed?.arn !== lambda.arn ||
      deployed.code !== lambda.code ||
      deployed.revision !== lambda.revision ||
      deployed.buildId !== lambda.buildId
    ) {
      throw new Error(
        `Action consumer ${lambda.role} changed during the drain`
      );
    }
  }
};
