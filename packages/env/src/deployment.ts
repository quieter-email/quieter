import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { httpsUrl, type RuntimeEnvironment } from "./schema";

export const createDeploymentEnv = (runtimeEnv: RuntimeEnvironment = process.env) =>
  createEnv({
    emptyStringAsUndefined: true,
    runtimeEnvStrict: {
      VERCEL_DEPLOY_HOOK_URL: runtimeEnv.VERCEL_DEPLOY_HOOK_URL,
      VERCEL_DEPLOYMENT_GIT_REF: runtimeEnv.VERCEL_DEPLOYMENT_GIT_REF,
      VERCEL_DEPLOYMENT_TARGET: runtimeEnv.VERCEL_DEPLOYMENT_TARGET,
      VERCEL_PROJECT_ID: runtimeEnv.VERCEL_PROJECT_ID,
      VERCEL_TEAM_ID: runtimeEnv.VERCEL_TEAM_ID,
      VERCEL_TOKEN: runtimeEnv.VERCEL_TOKEN,
    },
    server: {
      VERCEL_DEPLOY_HOOK_URL: httpsUrl,
      VERCEL_DEPLOYMENT_GIT_REF: z.string().trim().min(1).optional(),
      VERCEL_DEPLOYMENT_TARGET: z.enum(["production", "preview"]).default("production"),
      VERCEL_PROJECT_ID: z.string().trim().min(1),
      VERCEL_TEAM_ID: z.string().trim().min(1),
      VERCEL_TOKEN: z.string().trim().min(1),
    },
  });
