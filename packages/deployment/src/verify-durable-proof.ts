import assert from "node:assert/strict";
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
  !/^release-proof-do-[a-z0-9-]+$/u.test(env.QUIETER_RELEASE_STAGE) ||
  env.QUIETER_RELEASE_PROBE_TOKEN === undefined
) {
  throw new Error(
    "Durable Object drills require their isolated stage and linked secret."
  );
}
const outputs = z
  .object({
    candidateVersion: z.uuid().optional(),
    scriptName: z.string(),
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
const url = new URL(outputs.url);
if (
  !outputs.scriptName.includes(`-${env.QUIETER_RELEASE_STAGE}-`) ||
  url.protocol !== "https:" ||
  url.username !== "" ||
  url.password !== "" ||
  !url.hostname.startsWith(`${outputs.scriptName}.`) ||
  !url.hostname.endsWith(".workers.dev")
) {
  throw new Error(
    "Durable Object fixture outputs reference a different Worker."
  );
}
const provider = new CloudflareRuntimeProvider(
  env.CLOUDFLARE_ACCOUNT_ID,
  env.CLOUDFLARE_API_TOKEN
);
const deploymentSchema = z.object({ id: z.uuid(), versionId: z.uuid() });
const counterSchema = z.object({
  count: z.number().int().nonnegative(),
  generation: z.enum(["baseline", "candidate"]),
  versionId: z.uuid(),
});
const namespaceSchema = z.object({
  class_name: z.literal("ReleaseCounter"),
  name: z.literal("ReleaseCounter"),
  namespace_id: z.string().regex(/^[a-f\d]{32}$/u),
  type: z.literal("durable_object_namespace"),
});
const inspect = async (versionId: string) => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/workers/${outputs.scriptName}/versions/${versionId}`,
    {
      headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
      signal: AbortSignal.timeout(15_000),
    }
  );
  assert.equal(response.status, 200);
  const version = z
    .object({
      result: z.object({
        bindings: z.array(z.looseObject({ type: z.string() })),
        id: z.uuid(),
        migration_tag: z.literal("v1").optional(),
      }),
    })
    .parse(await response.json()).result;
  assert.equal(version.id, versionId);
  const namespaces = version.bindings.filter(
    (binding) => binding.type === "durable_object_namespace"
  );
  assert.equal(namespaces.length, 1);
  return namespaceSchema.parse(namespaces[0]);
};
const request = async (method: "GET" | "POST") => {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${env.QUIETER_RELEASE_PROBE_TOKEN}` },
    method,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200);
  return {
    counter: counterSchema.parse(await response.json()),
    workerVersion: response.headers.get("x-worker-version"),
  };
};
const read = async (versionId: string) => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- Wait for both the request Worker and the object instance to use the selected version.
    const result = await request("GET");
    if (
      result.workerVersion === versionId &&
      result.counter.versionId === versionId
    ) {
      return result.counter;
    }
    // oxlint-disable-next-line no-await-in-loop -- Bounded provider propagation wait without repeating a mutation.
    await setTimeout(3000);
  }
  throw new Error(
    "Worker and Durable Object did not converge to the selected version."
  );
};
const increment = async (
  versionId: string,
  count: number,
  generation: "baseline" | "candidate"
) => {
  const before = await read(versionId);
  assert.equal(before.count, count);
  assert.equal(before.generation, generation);
  const result = await request("POST");
  assert.equal(result.workerVersion, versionId);
  assert.equal(result.counter.versionId, versionId);
  assert.equal(result.counter.count, count + 1);
  assert.equal(result.counter.generation, generation);
  return result.counter;
};
const current = await provider.active(outputs.scriptName);
const namespace = await inspect(current.versionId);
const baselineFile = path.join(directory, "baseline.json");
if (mode === "baseline") {
  const unauthenticated = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(unauthenticated.status, 404);
  const before = await read(current.versionId);
  const counter = await increment(current.versionId, before.count, "baseline");
  await writeFile(
    baselineFile,
    JSON.stringify(
      {
        counter,
        deployment: current,
        namespace,
        scriptName: outputs.scriptName,
      },
      null,
      2
    ),
    { flag: "wx" }
  );
  process.stdout.write(
    "Baseline Durable Object namespace and counter recorded.\n"
  );
} else if (mode === "candidate") {
  const baseline = z
    .object({
      counter: counterSchema,
      deployment: deploymentSchema,
      namespace: namespaceSchema,
      scriptName: z.string(),
    })
    .parse(JSON.parse(await readFile(baselineFile, "utf-8")));
  assert.equal(outputs.scriptName, baseline.scriptName);
  assert.deepEqual(
    current,
    baseline.deployment,
    "Inactive upload changed the deployment."
  );
  assert.deepEqual(namespace, baseline.namespace);
  const candidate = z.uuid().parse(outputs.candidateVersion);
  assert.deepEqual(
    await inspect(candidate),
    namespace,
    "The candidate changed the namespace or class."
  );
  const inactive = await increment(
    current.versionId,
    baseline.counter.count,
    "baseline"
  );
  await writeFile(
    path.join(directory, "activation-intent.json"),
    JSON.stringify(
      { baseline: current, candidate, count: inactive.count, namespace },
      null,
      2
    ),
    { flag: "wx" }
  );
  let activated;
  try {
    await provider.activate(outputs.scriptName, candidate);
    activated = await increment(candidate, inactive.count, "candidate");
  } finally {
    const active = await provider.active(outputs.scriptName);
    if (
      ![candidate, baseline.deployment.versionId].includes(active.versionId)
    ) {
      // oxlint-disable-next-line no-unsafe-finally -- Unexpected active state must stop a conflicting rollback.
      throw new Error("Concurrent activation prevents fixture rollback.");
    }
    if (active.versionId === candidate) {
      await provider.activate(
        outputs.scriptName,
        baseline.deployment.versionId
      );
    }
  }
  const recovered = await increment(
    current.versionId,
    activated.count,
    "baseline"
  );
  const deployment = await provider.active(outputs.scriptName);
  assert.deepEqual(await inspect(deployment.versionId), namespace);
  await writeFile(
    path.join(directory, "completed.json"),
    JSON.stringify(
      { activated, deployment, inactive, namespace, recovered },
      null,
      2
    ),
    { flag: "wx" }
  );
  process.stdout.write(
    "Durable Object activation and rollback preserved the namespace and every counter increment.\n"
  );
} else {
  const completed = z
    .object({
      deployment: deploymentSchema,
      namespace: namespaceSchema,
      recovered: counterSchema,
    })
    .parse(
      JSON.parse(
        await readFile(path.join(directory, "completed.json"), "utf-8")
      )
    );
  assert.deepEqual(
    current,
    completed.deployment,
    "SST changed the recovered deployment."
  );
  assert.deepEqual(namespace, completed.namespace);
  const counter = await increment(
    current.versionId,
    completed.recovered.count,
    "baseline"
  );
  await writeFile(
    path.join(directory, "after-infrastructure.json"),
    JSON.stringify(
      {
        counter,
        deployment: current,
        namespace,
        verifiedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    { flag: "wx" }
  );
  process.stdout.write(
    "The following SST run preserved the rollback pointer, namespace, and retained counter.\n"
  );
}
