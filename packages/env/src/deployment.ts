import { z } from "zod";

import type { RuntimeEnvironment } from "./schema";

export const createDeploymentEnv = (
  runtime: RuntimeEnvironment = process.env
) => {
  let probeToken = runtime.QUIETER_RELEASE_PROBE_TOKEN;
  if (runtime.SST_RESOURCES_JSON !== undefined) {
    const links = z
      .object({
        App: z.object({ stage: z.string() }),
        ReleaseProofToken: z.object({ value: z.string().min(32) }).optional(),
      })
      .safeParse(JSON.parse(runtime.SST_RESOURCES_JSON));
    if (
      !links.success ||
      links.data.App.stage !== runtime.QUIETER_RELEASE_STAGE
    ) {
      throw new Error(
        "Linked release resources do not match the intended stage."
      );
    }
    probeToken = links.data.ReleaseProofToken?.value ?? probeToken;
  }
  if (runtime.SST_RESOURCE_ReleaseProofToken !== undefined) {
    const linked = z
      .object({ value: z.string().min(32) })
      .safeParse(JSON.parse(runtime.SST_RESOURCE_ReleaseProofToken));
    if (!linked.success) {
      throw new Error("Invalid linked release proof token.");
    }
    probeToken = linked.data.value;
  }
  const result = z
    .object({
      AWS_REGION: z.string().default("eu-central-1"),
      CLOUDFLARE_ACCOUNT_ID: z.string().regex(/^[a-f\d]{32}$/u),
      CLOUDFLARE_API_TOKEN: z.string().min(1),
      GITHUB_REPOSITORY: z
        .string()
        .regex(/^[\w.-]+\/[\w.-]+$/u)
        .optional(),
      GITHUB_TOKEN: z.string().min(1).optional(),
      QUIETER_RELEASE_BUCKET: z
        .string()
        .regex(/^[a-z\d][a-z\d.-]{1,61}[a-z\d]$/u),
      QUIETER_RELEASE_PROBE_TOKEN: z.string().min(32).optional(),
      QUIETER_RELEASE_STAGE: z.string().regex(/^[\w-]{1,128}$/u),
    })
    .safeParse({ ...runtime, QUIETER_RELEASE_PROBE_TOKEN: probeToken });
  if (!result.success) {
    throw new Error(
      `Invalid release configuration: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`
    );
  }
  return result.data;
};

export const createReleaseProofEnv = (
  runtime: RuntimeEnvironment = process.env
) => {
  const result = z
    .object({
      QUIETER_RELEASE_PROOF_PHASE: z
        .enum(["baseline", "adopt", "candidate"])
        .default("baseline"),
    })
    .safeParse(runtime);
  if (!result.success) {
    throw new Error("Invalid release proof phase.");
  }
  return result.data;
};

export const parseReleaseProbeBindings = (bindings: unknown) => {
  const result = z
    .object({
      ASSETS: z
        .custom<{ fetch: (request: Request) => Promise<Response> }>(
          (value) =>
            typeof value === "object" &&
            value !== null &&
            "fetch" in value &&
            typeof value.fetch === "function"
        )
        .optional(),
      PROBE_GENERATION: z.enum(["baseline", "candidate"]),
      PROBE_TOKEN: z.string().min(32),
    })
    .safeParse(bindings);
  if (!result.success) {
    throw new Error("Release probe bindings are incomplete.");
  }
  return result.data;
};
