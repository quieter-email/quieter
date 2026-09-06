import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";

import { createDeploymentEnv } from "@quieter/env/deployment";
import { z } from "zod";

import { CloudflareRuntimeProvider } from "./cloudflare.ts";

const { values } = parseArgs({
  options: { directory: { type: "string" }, mode: { type: "string" } },
});
const mode = z
  .enum(["baseline", "candidate", "after-infrastructure"])
  .parse(values.mode);
const directory = z.string().min(1).parse(values.directory);
const env = createDeploymentEnv();
if (
  !/^release-proof-triggers-[a-z0-9-]+$/u.test(env.QUIETER_RELEASE_STAGE) ||
  env.QUIETER_RELEASE_PROBE_TOKEN === undefined
) {
  throw new Error(
    "Trigger drills require an isolated stage and its linked proof secret."
  );
}
const outputs = z
  .object({
    candidateVersion: z.uuid().optional(),
    consumerId: z.string().min(1),
    queueId: z.string().min(1),
    schedules: z.array(z.object({ cron: z.string() })),
    scriptName: z.string().min(1),
    url: z.url(),
  })
  .parse(
    JSON.parse(
      await readFile(
        path.resolve(import.meta.dirname, "../../../.sst/outputs.json"),
        "utf-8"
      )
    )
  );
const fixtureUrl = new URL(outputs.url);
if (
  !outputs.scriptName.includes(`-${env.QUIETER_RELEASE_STAGE}-`) ||
  fixtureUrl.protocol !== "https:" ||
  fixtureUrl.username !== "" ||
  fixtureUrl.password !== "" ||
  !fixtureUrl.hostname.startsWith(`${outputs.scriptName}.`) ||
  !fixtureUrl.hostname.endsWith(".workers.dev")
) {
  throw new Error(
    "Trigger fixture outputs do not match the intended isolated Worker."
  );
}
const provider = new CloudflareRuntimeProvider(
  env.CLOUDFLARE_ACCOUNT_ID,
  env.CLOUDFLARE_API_TOKEN
);
const current = await provider.active(outputs.scriptName);
const request = async (route: string, init?: RequestInit) =>
  await fetch(new URL(route, outputs.url), {
    ...init,
    headers: { authorization: `Bearer ${env.QUIETER_RELEASE_PROBE_TOKEN}` },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
const waitFor = async (
  route: string,
  target: string,
  after: number,
  scheduled: boolean
) => {
  const deadline = Date.now() + (scheduled ? 15 * 60_000 : 120_000);
  let lastProgress = Date.now();
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- Poll bounded synthetic evidence while provider triggers propagate.
    const response = await request(route);
    if (response.ok) {
      // oxlint-disable-next-line no-await-in-loop -- Read this sample before deciding whether another is needed.
      const body: unknown = await response.json();
      const record = z
        .object({
          generation: z.enum(["baseline", "candidate"]),
          scheduledTime: z.number().optional(),
          versionId: z.uuid(),
        })
        .parse(body);
      assert.equal(
        record.versionId,
        target,
        "The trigger executed an unexpected version."
      );
      if (
        !scheduled ||
        (record.scheduledTime !== undefined && record.scheduledTime >= after)
      ) {
        return record;
      }
    } else if (response.status !== 404) {
      throw new Error(`Trigger evidence returned HTTP ${response.status}.`);
    }
    if (Date.now() - lastProgress >= 30_000) {
      process.stdout.write(
        `Waiting for ${scheduled ? "scheduled" : "queue"} trigger evidence.\n`
      );
      lastProgress = Date.now();
    }
    // oxlint-disable-next-line no-await-in-loop -- Finite provider propagation wait, with progress every thirty seconds.
    await setTimeout(5000);
  }
  throw new Error(
    "Trigger evidence did not arrive before its bounded deadline."
  );
};
const sample = async (
  versionId: string,
  generation: "baseline" | "candidate"
) => {
  process.stdout.write(
    `Checking queue and scheduled execution on ${generation}.\n`
  );
  const startedAt = Date.now();
  const id = randomUUID();
  const publication = await request("/queue", {
    body: JSON.stringify({ id }),
    method: "POST",
  });
  assert.equal(publication.status, 202);
  const [queue, scheduled] = await Promise.all([
    waitFor(`/records/queue/${id}`, versionId, startedAt, false),
    waitFor(`/records/scheduled/${versionId}`, versionId, startedAt, true),
  ]);
  assert.equal(queue.generation, generation);
  assert.equal(scheduled.generation, generation);
  return { finishedAt: new Date().toISOString(), queue, scheduled, startedAt };
};
const baselineFile = path.join(directory, "baseline.json");
if (mode === "baseline") {
  const unauthenticated = await fetch(outputs.url, {
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(unauthenticated.status, 404);
  const evidence = await sample(current.versionId, "baseline");
  await writeFile(
    baselineFile,
    JSON.stringify({ ...outputs, deployment: current, evidence }, null, 2),
    { flag: "wx" }
  );
  process.stdout.write(
    "Baseline queue and scheduled events executed the active version.\n"
  );
} else if (mode === "candidate") {
  const baseline = z
    .object({
      consumerId: z.string(),
      deployment: z.object({ id: z.uuid(), versionId: z.uuid() }),
      queueId: z.string(),
      scriptName: z.string(),
    })
    .parse(JSON.parse(await readFile(baselineFile, "utf-8")));
  assert.equal(outputs.scriptName, baseline.scriptName);
  assert.equal(outputs.consumerId, baseline.consumerId);
  assert.equal(outputs.queueId, baseline.queueId);
  assert.deepEqual(
    current,
    baseline.deployment,
    "Inactive upload changed the baseline deployment."
  );
  const candidate = z.uuid().parse(outputs.candidateVersion);
  const inactive = await sample(current.versionId, "baseline");
  await writeFile(
    path.join(directory, "activation-intent.json"),
    JSON.stringify(
      { baseline, candidate, startedAt: new Date().toISOString() },
      null,
      2
    ),
    { flag: "wx" }
  );
  let candidateEvidence;
  try {
    await provider.activate(outputs.scriptName, candidate);
    candidateEvidence = await sample(candidate, "candidate");
  } finally {
    const active = await provider.active(outputs.scriptName);
    if (
      ![candidate, baseline.deployment.versionId].includes(active.versionId)
    ) {
      // oxlint-disable-next-line no-unsafe-finally -- Conflicting active state must stop rollback even when the candidate check also failed.
      throw new Error(
        "Unexpected concurrent activation prevents automatic fixture rollback."
      );
    }
    if (active.versionId === candidate) {
      await provider.activate(
        outputs.scriptName,
        baseline.deployment.versionId
      );
    }
  }
  const recovered = await sample(baseline.deployment.versionId, "baseline");
  const deployment = await provider.active(outputs.scriptName);
  assert.equal(deployment.versionId, baseline.deployment.versionId);
  await writeFile(
    path.join(directory, "completed.json"),
    JSON.stringify(
      { candidate, candidateEvidence, deployment, inactive, recovered },
      null,
      2
    ),
    { flag: "wx" }
  );
  process.stdout.write(
    "Inactive upload, queue and scheduled activation, and retained-version rollback passed.\n"
  );
} else {
  const baseline = z
    .object({
      consumerId: z.string(),
      queueId: z.string(),
      scriptName: z.string(),
    })
    .parse(JSON.parse(await readFile(baselineFile, "utf-8")));
  const completed = z
    .object({ deployment: z.object({ id: z.uuid(), versionId: z.uuid() }) })
    .parse(
      JSON.parse(
        await readFile(path.join(directory, "completed.json"), "utf-8")
      )
    );
  assert.equal(outputs.consumerId, baseline.consumerId);
  assert.equal(outputs.queueId, baseline.queueId);
  assert.equal(outputs.scriptName, baseline.scriptName);
  assert.deepEqual(
    current,
    completed.deployment,
    "SST changed the recovered deployment pointer."
  );
  assert.deepEqual(
    outputs.schedules,
    [],
    "Disable the fixture schedule after the drill."
  );
  const id = randomUUID();
  const publication = await request("/queue", {
    body: JSON.stringify({ id }),
    method: "POST",
  });
  assert.equal(publication.status, 202);
  const queue = await waitFor(
    `/records/queue/${id}`,
    current.versionId,
    Date.now(),
    false
  );
  assert.equal(queue.generation, "baseline");
  await writeFile(
    path.join(directory, "after-infrastructure.json"),
    JSON.stringify(
      { deployment: current, queue, verifiedAt: new Date().toISOString() },
      null,
      2
    ),
    { flag: "wx" }
  );
  process.stdout.write(
    "The SST update preserved the rollback pointer and queue identity; the fixture schedule is disabled.\n"
  );
}
