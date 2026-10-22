import { z } from "zod";

export const DEPLOYMENT_BUILD_HEADER = "x-quieter-build-id";
export const DEPLOYMENT_RELOAD_HEADER = "x-quieter-reload";
export const DEPLOYMENT_STATUS_PATH = "/assets/deployment.json";
export const DEPLOYMENT_ASSET_PREFIX = "/_releases/";

const deploymentBuildSchema = z.object({
  buildId: z.string().regex(/^[\w.-]{1,128}$/u),
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
