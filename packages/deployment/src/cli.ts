import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { S3Client } from "@aws-sdk/client-s3";
import { createDeploymentEnv } from "@quieter/env/deployment";
import { z } from "zod";

import { S3ArchiveStore } from "./archive-store.ts";
import { ReleaseArtifactStore } from "./artifact-store.ts";
import { readArtifactFile, releaseArtifactSchema } from "./artifact.ts";
import { AssetArchive } from "./assets.ts";
import type { AssetManifest } from "./assets.ts";
import { CloudflareRuntimeProvider } from "./cloudflare.ts";
import { assertCompatible } from "./compatibility.ts";
import { ReleaseController } from "./controller.ts";
import { observeRelease, verifyReleaseHealth } from "./health.ts";
import { ObjectReleaseJournal } from "./journal.ts";
import { ReleasePreflight } from "./preflight.ts";
import { createR2ArchiveClient } from "./r2-archive-client.ts";
import { reconcileRelease } from "./recovery.ts";
import {
  healthyReleaseSchema,
  identifierSchema,
  probeConfigurationSchema,
} from "./schema.ts";
import { ObjectUploadStore } from "./upload-store.ts";
import { ReleaseUpload, uploadIntentSchema } from "./upload.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    attempt: { type: "string" },
    directory: { type: "string" },
    "event-run": { type: "string" },
    file: { type: "string" },
    probes: { type: "string" },
    reason: { type: "string" },
    rollback: { default: false, type: "boolean" },
    run: { type: "string" },
  },
});
const command = z
  .enum([
    "status",
    "verify-artifacts",
    "register",
    "upload",
    "reconcile-upload",
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
  !["status", "verify-artifacts"].includes(command) &&
  !env.QUIETER_RELEASE_STAGE.startsWith("release-proof-")
) {
  throw new Error(
    "Runtime mutation is restricted to isolated release-proof stages until ownership and recovery cutover is verified."
  );
}
const storage = new S3Client({
  maxAttempts: 1,
  region: env.AWS_REGION,
  requestHandler: {
    connectionTimeout: 5000,
    requestTimeout: 15_000,
    throwOnRequestTimeout: true,
  },
});
const journal = new ObjectReleaseJournal(
  storage,
  env.QUIETER_RELEASE_BUCKET,
  env.QUIETER_RELEASE_STAGE
);
const provider = new CloudflareRuntimeProvider(
  env.CLOUDFLARE_ACCOUNT_ID,
  env.CLOUDFLARE_API_TOKEN
);
const artifacts = new ReleaseArtifactStore(
  storage,
  env.QUIETER_RELEASE_BUCKET,
  env.QUIETER_RELEASE_STAGE
);
const archive = {
  async verify(manifest: AssetManifest) {
    if (env.CLOUDFLARE_ARCHIVE_PARENT_KEY_ID === undefined) {
      throw new Error(
        "Browser release verification requires archive read access."
      );
    }
    const bucket = `${env.QUIETER_RELEASE_STAGE}-archive`;
    const client = createR2ArchiveClient({
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      bucket,
      parentAccessKeyId: env.CLOUDFLARE_ARCHIVE_PARENT_KEY_ID,
      readOnly: true,
      token: env.CLOUDFLARE_API_TOKEN,
    });
    try {
      await new AssetArchive(new S3ArchiveStore(client, bucket)).verify(
        manifest
      );
    } finally {
      client.destroy();
    }
  },
};
const preflight = new ReleasePreflight(artifacts, archive, provider);
const uploads = new ObjectUploadStore(
  storage,
  env.QUIETER_RELEASE_BUCKET,
  env.QUIETER_RELEASE_STAGE
);
const uploader = new ReleaseUpload(uploads, artifacts, archive, provider);
const controller = new ReleaseController(journal, provider, preflight, {
  async candidate(attempt) {
    await verifyReleaseHealth(
      attempt.candidate,
      attempt.probes,
      env.QUIETER_RELEASE_PROBE_TOKEN,
      "candidateUrl"
    );
  },
  async recovered(attempt) {
    await verifyReleaseHealth(
      attempt.baseline,
      attempt.probes,
      env.QUIETER_RELEASE_PROBE_TOKEN,
      "url"
    );
  },
});
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
  case "upload": {
    if (values.file === undefined || values.directory === undefined) {
      throw new Error(
        "Upload requires the durable intent --file and compiled --directory."
      );
    }
    const intent = uploadIntentSchema.parse(
      JSON.parse(await readFile(values.file, "utf-8"))
    );
    if (!intent.scriptName.includes(`-${env.QUIETER_RELEASE_STAGE}-`)) {
      throw new Error(
        "Upload intent references a Worker outside this proof stage."
      );
    }
    const receipt = await uploader.upload(intent, values.directory);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    break;
  }
  case "reconcile-upload": {
    const intent = await uploads.read(z.uuid().parse(values.attempt));
    if (!intent.scriptName.includes(`-${env.QUIETER_RELEASE_STAGE}-`)) {
      throw new Error(
        "Upload intent references a Worker outside this proof stage."
      );
    }
    const receipt = await uploader.reconcile(intent.id);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    break;
  }
  case "verify-artifacts": {
    if (existing === null) {
      throw new Error("There is no retained release to verify.");
    }
    await preflight.verify(existing.state.healthy);
    process.stdout.write(
      "Verified retained modules and archives for the recorded healthy release.\n"
    );
    break;
  }
  case "register": {
    if (values.file === undefined || values.directory === undefined) {
      throw new Error(
        "Register requires the tested --file manifest and compiled --directory."
      );
    }
    const manifest = releaseArtifactSchema.parse(
      JSON.parse(await readFile(values.file, "utf-8"))
    );
    for (const file of manifest.artifact.modules) {
      const subdirectory = ["_headers", "_redirects"].includes(file.path)
        ? "client"
        : "server";
      // oxlint-disable-next-line no-await-in-loop -- Verify the retained manifest against the tested build.
      await readArtifactFile(path.join(values.directory, subdirectory), file);
    }
    for (const file of manifest.artifact.assets) {
      // oxlint-disable-next-line no-await-in-loop -- Include static files that are not eligible for browser fallback.
      await readArtifactFile(path.join(values.directory, "client"), file);
    }
    if (manifest.archive !== null) {
      await archive.verify(manifest.archive);
    }
    await artifacts.write(manifest);
    process.stdout.write(`Retained verified artifact ${manifest.digest}.\n`);
    break;
  }
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
    if (
      values.file === undefined ||
      values.probes === undefined ||
      (await journal.read()) !== null
    ) {
      throw new Error(
        "Bootstrap requires a baseline file and an empty journal."
      );
    }
    const healthy = healthyReleaseSchema.parse(
      JSON.parse(await readFile(values.file, "utf-8"))
    );
    assertCompatible(healthy.services);
    await preflight.verify(healthy);
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
    await verifyReleaseHealth(
      healthy,
      probeConfigurationSchema.parse(
        JSON.parse(await readFile(values.probes, "utf-8"))
      ),
      env.QUIETER_RELEASE_PROBE_TOKEN,
      "url"
    );
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
    if (values.file === undefined || values.probes === undefined) {
      throw new Error(
        "Prepare requires an immutable release manifest and --probes configuration."
      );
    }
    await controller.prepare({
      candidate: healthyReleaseSchema.parse(
        JSON.parse(await readFile(values.file, "utf-8"))
      ),
      id: identifierSchema.parse(values.attempt),
      mode: values.rollback ? "rollback" : "promote",
      probes: probeConfigurationSchema.parse(
        JSON.parse(await readFile(values.probes, "utf-8"))
      ),
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
      attempt?.probes === undefined ||
      attempt.id !== values.attempt ||
      env.QUIETER_RELEASE_PROBE_TOKEN === undefined
    ) {
      throw new Error(
        "Observe requires the active attempt, probe configuration, and linked probe secret."
      );
    }
    const evidence = await observeRelease(
      attempt,
      attempt.probes,
      env.QUIETER_RELEASE_PROBE_TOKEN
    );
    await controller.certify(attempt.id, evidence);
    break;
  }
}
