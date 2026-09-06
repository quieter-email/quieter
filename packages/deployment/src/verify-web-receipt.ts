import { readFile } from "node:fs/promises";
import path from "node:path";

import { createDeploymentEnv } from "@quieter/env/deployment";
import { z } from "zod";

import { CloudflareRuntimeProvider } from "./cloudflare.ts";
import {
  activeDeploymentSchema,
  digestSchema,
  identifierSchema,
} from "./schema.ts";
import { verifyWebCandidate } from "./web-proof.ts";

const env = createDeploymentEnv();
const root = path.resolve(import.meta.dirname, "../../..");
const receipt = z
  .object({
    artifactDigest: digestSchema,
    baseline: activeDeploymentSchema,
    directory: z.string(),
    scriptName: identifierSchema,
    versionId: z.uuid(),
  })
  .parse(
    JSON.parse(
      await readFile(
        path.join(root, ".scratch/web-proof-receipt.json"),
        "utf-8"
      )
    )
  );
const outputs = z
  .object({ webScriptName: identifierSchema, webUrl: z.url() })
  .parse(
    JSON.parse(await readFile(path.join(root, ".sst/outputs.json"), "utf-8"))
  );
if (
  !env.QUIETER_RELEASE_STAGE.startsWith("release-proof-") ||
  env.QUIETER_RELEASE_PROBE_TOKEN === undefined ||
  !receipt.scriptName.includes(`-${env.QUIETER_RELEASE_STAGE}-`) ||
  outputs.webScriptName !== receipt.scriptName ||
  !new URL(outputs.webUrl).hostname.endsWith(".workers.dev")
) {
  throw new Error(
    "Receipt verification requires the isolated linked web proof stage."
  );
}
await verifyWebCandidate({
  ...receipt,
  provider: new CloudflareRuntimeProvider(
    env.CLOUDFLARE_ACCOUNT_ID,
    env.CLOUDFLARE_API_TOKEN
  ),
  publicUrl: outputs.webUrl,
  token: env.QUIETER_RELEASE_PROBE_TOKEN,
});
process.stdout.write(
  "Verified provider module bytes, protected TanStack SSR, JS/CSS/font bytes and MIME, and unchanged runtime from the retained web proof receipt.\n"
);
