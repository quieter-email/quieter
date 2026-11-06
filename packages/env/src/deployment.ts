import { z } from "zod";

export const DEPLOYMENT_BUILD_HEADER = "x-quieter-build-id";
export const DEPLOYMENT_RELOAD_HEADER = "x-quieter-reload";
export const DEPLOYMENT_STATUS_PATH = "/assets/deployment.json";
export const DEPLOYMENT_ASSET_PREFIX = "/_releases/";

export const PERSONAL_ACTION_PROTOCOL = "personal-actions-v1";

export const actionReleaseEnvironmentSchema = z.object({
  QUIETER_ACTION_PROTOCOL: z.literal(PERSONAL_ACTION_PROTOCOL),
  QUIETER_BUILD_ID: z.string().regex(/^[\w.-]{1,128}$/u),
});

const deploymentBuildSchema = z.object({
  buildId: z.string().regex(/^[\w.-]{1,128}$/u),
  protocol: z.string().min(1).optional(),
  slot: z.enum(["a", "b"]),
});

export const deploymentManifestSchema = z
  .object({
    current: deploymentBuildSchema,
    previous: deploymentBuildSchema
      .extend({ expiresAt: z.number().int().nonnegative() })
      .nullable(),
  })
  .refine(
    ({ current, previous }) =>
      previous === null ||
      (previous.buildId !== current.buildId && previous.slot !== current.slot),
    { message: "Web releases must use different builds and slots." }
  );

export const deploymentStatusSchema = deploymentManifestSchema.safeExtend({
  serverTime: z.number().int().nonnegative(),
});

export const webReleasePlanSchema = z
  .object({
    manifest: deploymentManifestSchema,
    sourceBuildId: deploymentBuildSchema.shape.buildId.nullable(),
    sourceDeployment: deploymentBuildSchema.nullable().optional(),
    updateSlot: z.enum(["a", "b"]).nullable(),
  })
  .refine(
    ({ manifest, updateSlot }) =>
      updateSlot === null || updateSlot === manifest.current.slot,
    { message: "The updated release slot must match the current build." }
  )
  .refine(
    ({ manifest, sourceBuildId, updateSlot }) =>
      updateSlot === null
        ? sourceBuildId === manifest.current.buildId
        : manifest.previous === null ||
          sourceBuildId === manifest.previous.buildId,
    { message: "The release source must match the captured active build." }
  );

export type DeploymentManifest = z.infer<typeof deploymentManifestSchema>;

export const createWebDeploymentEnv = (
  runtime: Record<string, unknown>
): DeploymentManifest => {
  const configuration = z.string().parse(runtime.QUIETER_WEB_DEPLOYMENT);
  return deploymentManifestSchema.parse(JSON.parse(configuration));
};

export const createDeploymentVerificationEnv = (
  runtime: Record<string, unknown> = process.env
) =>
  z
    .object({
      CLOUDFLARE_API_TOKEN: z.string().min(1),
      CLOUDFLARE_DEFAULT_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/u),
      GITHUB_SHA: z.string().regex(/^[a-f0-9]{40}$/u),
      QUIETER_BUILD_ID: actionReleaseEnvironmentSchema.shape.QUIETER_BUILD_ID,
    })
    .parse(runtime);
