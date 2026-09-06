import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { S3Client } from "@aws-sdk/client-s3";
import { createDeploymentEnv } from "@quieter/env/deployment";
import { z } from "zod";

import { CloudflareRuntimeProvider } from "./cloudflare.ts";
import { assertCompatible } from "./compatibility.ts";
import { ReleaseController } from "./controller.ts";
import { observeRelease, probeConfigurationSchema } from "./health.ts";
import { ObjectReleaseJournal } from "./journal.ts";
import { reconcileRelease } from "./recovery.ts";
import { healthyReleaseSchema, identifierSchema } from "./schema.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    attempt: { type: "string" },
    "event-run": { type: "string" },
    file: { type: "string" },
    reason: { type: "string" },
    run: { type: "string" },
  },
});
const command = z
  .enum([
    "status",
    "bootstrap",
    "prepare",
    "promote",
    "recover",
    "observe",
    "reconcile",
  ])
  .parse(positionals[0]);
const env = createDeploymentEnv();
if (
  command !== "status" &&
  !env.QUIETER_RELEASE_STAGE.startsWith("release-proof-")
) {
  throw new Error(
    "Runtime mutation is restricted to isolated release-proof stages until ownership and recovery cutover is verified."
  );
}
const journal = new ObjectReleaseJournal(
  new S3Client({
    maxAttempts: 1,
    region: env.AWS_REGION,
    requestHandler: {
      connectionTimeout: 5000,
      requestTimeout: 15_000,
      throwOnRequestTimeout: true,
    },
  }),
  env.QUIETER_RELEASE_BUCKET,
  env.QUIETER_RELEASE_STAGE
);
const provider = new CloudflareRuntimeProvider(
  env.CLOUDFLARE_ACCOUNT_ID,
  env.CLOUDFLARE_API_TOKEN
);
const controller = new ReleaseController(journal, provider);
const existing = await journal.read();
if (
  command !== "status" &&
  existing !== null &&
  existing.state.healthy.services.some(
    (service) => !service.scriptName.includes(`-${env.QUIETER_RELEASE_STAGE}-`)
  )
) {
  throw new Error(
    "The journal references Workers outside this isolated proof stage."
  );
}
// oxlint-disable-next-line default-case -- The validated command union is exhaustive.
switch (command) {
  case "reconcile": {
    if (env.GITHUB_REPOSITORY === undefined || env.GITHUB_TOKEN === undefined) {
      throw new Error("Reconciliation requires GitHub workflow read access.");
    }
    const result = await reconcileRelease(controller, {
      eventRunId:
        values["event-run"] === undefined
          ? undefined
          : z.string().regex(/^\d+$/u).parse(values["event-run"]),
      repository: env.GITHUB_REPOSITORY,
      token: env.GITHUB_TOKEN,
    });
    process.stdout.write(`${result}\n`);
    break;
  }
  case "status": {
    const checkpoint = await journal.read();
    process.stdout.write(
      `${JSON.stringify(checkpoint?.state ?? null, null, 2)}\n`
    );
    break;
  }
  case "bootstrap": {
    if (values.file === undefined || (await journal.read()) !== null) {
      throw new Error(
        "Bootstrap requires a baseline file and an empty journal."
      );
    }
    const healthy = healthyReleaseSchema.parse(
      JSON.parse(await readFile(values.file, "utf-8"))
    );
    assertCompatible(healthy.services);
    if (
      healthy.services.some(
        (service) =>
          !service.scriptName.includes(`-${env.QUIETER_RELEASE_STAGE}-`)
      )
    ) {
      throw new Error(
        "Bootstrap cannot target Workers outside the isolated proof stage."
      );
    }
    for (const service of healthy.services) {
      // oxlint-disable-next-line no-await-in-loop -- Inventory live versions before seeding the isolated proof's baseline.
      const active = await provider.active(service.scriptName);
      if (active.versionId !== service.versionId) {
        throw new Error(
          "Bootstrap baseline differs from active provider state."
        );
      }
    }
    await journal.write(null, {
      attempt: null,
      healthy,
      history: [],
      quarantinedArtifacts: [],
      schemaVersion: 1,
      stage: env.QUIETER_RELEASE_STAGE,
    });
    break;
  }
  case "prepare": {
    if (values.file === undefined) {
      throw new Error("Prepare requires an immutable release manifest.");
    }
    await controller.prepare({
      candidate: healthyReleaseSchema.parse(
        JSON.parse(await readFile(values.file, "utf-8"))
      ),
      id: identifierSchema.parse(values.attempt),
      workflowRunId: z.string().regex(/^\d+$/u).parse(values.run),
    });
    break;
  }
  case "promote": {
    await controller.promote(identifierSchema.parse(values.attempt));
    break;
  }
  case "recover": {
    await controller.recover(
      identifierSchema.parse(values.attempt),
      identifierSchema.parse(values.reason)
    );
    break;
  }
  case "observe": {
    const checkpoint = await journal.read();
    const attempt = checkpoint?.state.attempt;
    if (
      values.file === undefined ||
      !attempt ||
      attempt.id !== values.attempt ||
      env.QUIETER_RELEASE_PROBE_TOKEN === undefined
    ) {
      throw new Error(
        "Observe requires the active attempt, probe configuration, and linked probe secret."
      );
    }
    const probes = probeConfigurationSchema.parse(
      JSON.parse(await readFile(values.file, "utf-8"))
    );
    const evidence = await observeRelease(
      attempt,
      probes,
      env.QUIETER_RELEASE_PROBE_TOKEN
    );
    await controller.certify(attempt.id, evidence);
    break;
  }
}
