import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { createActionCutoverRecoveryEnv } from "@quieter/env/deployment";
import { z } from "zod";

import { releaseRecoveredPersonalActionCutover } from "../packages/database/scripts/release-recovered-personal-action-cutover.ts";
import {
  actionEvidenceSchema,
  assertRecoveryContinuity,
  recoveryArtifactSchema,
  validateRecoveryProvenance,
} from "./action-cutover-recovery.ts";
import { checkActionDeployment } from "./check-action-deployment.ts";
import { checkDeployment } from "./check-deployment.ts";

// oxlint-disable-next-line typescript/strict-void-return -- Node provides a custom promisify implementation for execFile.
const execute = promisify(execFile);
const evidenceDirectory = "action-cutover-recovery";

const api = async (route: string): Promise<unknown> => {
  const { stdout } = await execute("gh", ["api", route], { timeout: 30_000 });
  return JSON.parse(stdout);
};

export const recoverPersonalActionCutover = async (
  mode: string | undefined
) => {
  if (mode !== "prepare" && mode !== "release") {
    throw new Error("Expected prepare or release");
  }
  const env = createActionCutoverRecoveryEnv();
  const base = `repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.DEPLOYMENT_RUN}`;
  const [run, jobs, artifacts] = await Promise.all([
    api(`${base}/attempts/${env.DEPLOYMENT_ATTEMPT}`),
    api(`${base}/attempts/${env.DEPLOYMENT_ATTEMPT}/jobs?per_page=100`),
    api(`${base}/artifacts?name=action-cutover&per_page=100`),
  ]);
  const artifactList = z
    .object({
      artifacts: z.array(recoveryArtifactSchema),
      total_count: z.literal(1),
    })
    .parse(artifacts);
  const [artifact] = artifactList.artifacts;
  if (artifactList.artifacts.length !== 1 || artifact === undefined) {
    throw new Error("Original cutover artifact is missing or ambiguous");
  }
  await mkdir(evidenceDirectory, { recursive: true });
  const initialFile = `${evidenceDirectory}/original-evidence.json`;
  if (mode === "prepare") {
    const { stdout: archive } = await execute(
      "gh",
      [
        "api",
        `repos/${env.GITHUB_REPOSITORY}/actions/artifacts/${artifact.id}/zip`,
      ],
      { encoding: "buffer", maxBuffer: 10_000_000, timeout: 30_000 }
    );
    if (
      `sha256:${createHash("sha256").update(archive).digest("hex")}` !==
      artifact.digest
    ) {
      throw new Error("Original cutover artifact digest does not match GitHub");
    }
    const archiveFile = `${evidenceDirectory}/original.zip`;
    await writeFile(archiveFile, archive, { flag: "wx" });
    const { stdout } = await execute(
      "unzip",
      ["-p", archiveFile, "action-deployment-initial-evidence.json"],
      { maxBuffer: 1_000_000, timeout: 10_000 }
    );
    await writeFile(initialFile, stdout, { flag: "wx" });
    await writeFile(
      `${evidenceDirectory}/artifact.json`,
      JSON.stringify(artifact),
      { flag: "wx" }
    );
  } else {
    const preparedArtifact = recoveryArtifactSchema.parse(
      JSON.parse(await readFile(`${evidenceDirectory}/artifact.json`, "utf-8"))
    );
    if (
      preparedArtifact.id !== artifact.id ||
      preparedArtifact.digest !== artifact.digest
    ) {
      throw new Error("Original cutover artifact changed during recovery");
    }
  }
  const recovery = validateRecoveryProvenance({
    artifact,
    attempt: env.DEPLOYMENT_ATTEMPT,
    evidence: JSON.parse(await readFile(initialFile, "utf-8")),
    jobs,
    now: Date.now(),
    run,
    runId: env.DEPLOYMENT_RUN,
  });
  if (mode === "prepare") {
    const targets = {
      actionDeploymentTargets: {
        lambdas: Object.fromEntries(
          recovery.evidence.lambdas.map(({ arn, role }) => [role, arn])
        ),
        workers: Object.fromEntries(
          recovery.evidence.workers
            .filter(({ role }) => role !== "web-a" && role !== "web-b")
            .map(({ role, script }) => [role, script])
        ),
      },
      stage: "production",
    };
    await writeFile(
      `${evidenceDirectory}/targets.json`,
      JSON.stringify(targets),
      { flag: "wx" }
    );
    process.stdout.write(
      `Original drain elapsed at ${recovery.drainDeadline}. No deployment or wait is needed.\n`
    );
    return;
  }
  await checkDeployment(
    "https://quieter.email",
    recovery.buildId,
    "https://updates.quieter.email/mail/live"
  );
  const first = await checkActionDeployment({
    account: env.CLOUDFLARE_DEFAULT_ACCOUNT_ID,
    buildId: recovery.buildId,
    evidenceFile: `${evidenceDirectory}/fresh-evidence.json`,
    outputsFile: `${evidenceDirectory}/targets.json`,
    sourceCommit: recovery.sourceCommit,
    token: env.CLOUDFLARE_API_TOKEN,
  });
  assertRecoveryContinuity(
    recovery.evidence,
    actionEvidenceSchema.parse(first)
  );
  const final = await checkActionDeployment({
    account: env.CLOUDFLARE_DEFAULT_ACCOUNT_ID,
    buildId: recovery.buildId,
    evidenceFile: `${evidenceDirectory}/final-evidence.json`,
    outputsFile: `${evidenceDirectory}/targets.json`,
    sourceCommit: recovery.sourceCommit,
    token: env.CLOUDFLARE_API_TOKEN,
  });
  assertRecoveryContinuity(
    recovery.evidence,
    actionEvidenceSchema.parse(final)
  );
  const released = await releaseRecoveredPersonalActionCutover({
    buildId: recovery.sourceCommit,
    expectedWorkflowIdentity: recovery.workflowIdentity,
    verifiedDeploymentBuildId: recovery.sourceCommit,
    workflowIdentity: `${env.GITHUB_RUN_ID}/${env.GITHUB_RUN_ATTEMPT}`,
  });
  await writeFile(
    `${evidenceDirectory}/released.json`,
    JSON.stringify(released),
    { flag: "wx" }
  );
  process.stdout.write(
    "Released the original verified personal Action cutover.\n"
  );
};

if (import.meta.main) {
  await recoverPersonalActionCutover(process.argv[2]);
}
