import { z } from "zod";

export type RuntimeHealthBindings = {
  QUIETER_RUNTIME_HEALTH?: string;
  SST_RESOURCE_App?: string;
  SST_RESOURCE_ReleaseProofToken?: string;
  SST_RESOURCES_JSON?: string;
  QUIETER_VERSION?: { id: string };
};

export const createRuntimeHealthEnv = (runtime: RuntimeHealthBindings) => {
  if (runtime.QUIETER_RUNTIME_HEALTH === undefined) {
    return null;
  }
  try {
    const configuration = z
      .strictObject({
        publicHosts: z.array(z.hostname()).max(20),
        stage: z.string().min(1),
      })
      .parse(JSON.parse(runtime.QUIETER_RUNTIME_HEALTH));
    const app: unknown =
      runtime.SST_RESOURCES_JSON !== undefined ||
      runtime.SST_RESOURCE_App === undefined
        ? undefined
        : JSON.parse(runtime.SST_RESOURCE_App);
    const healthToken: unknown =
      runtime.SST_RESOURCES_JSON !== undefined ||
      runtime.SST_RESOURCE_ReleaseProofToken === undefined
        ? undefined
        : JSON.parse(runtime.SST_RESOURCE_ReleaseProofToken);
    const links = z
      .object({
        App: z.object({ stage: z.string().min(1) }).optional(),
        ReleaseProofToken: z.object({ value: z.string().min(32).max(256) }),
      })
      .parse(
        runtime.SST_RESOURCES_JSON === undefined
          ? {
              App: app,
              ReleaseProofToken: healthToken,
            }
          : JSON.parse(runtime.SST_RESOURCES_JSON)
      );
    if (links.App?.stage !== configuration.stage) {
      throw new Error(
        "Release health stage differs from the linked application."
      );
    }
    return {
      publicHosts: configuration.publicHosts,
      token: links.ReleaseProofToken.value,
      versionId: z.uuid().parse(runtime.QUIETER_VERSION?.id),
    };
  } catch {
    throw new Error("Invalid release health bindings.");
  }
};
