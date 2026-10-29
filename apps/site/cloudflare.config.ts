import { fileURLToPath } from "node:url";

import { createServerEnv } from "@quieter/env/server";
import { bindings, defineConfig } from "cf/config";
import type { WorkerConfig } from "cf/config";
import { loadEnv } from "vite";
import { unstable_readConfig } from "wrangler";
import { z } from "zod";

import { COMPATIBILITY_DATE } from "../../packages/cloudflare/src/compatibility-date.ts";

export default defineConfig(({ mode }) => {
  const configPath = process.env.SST_WRANGLER_PATH;
  if (configPath) {
    const config = z
      .object({
        compatibility_flags: z.array(z.string()).default([]),
        durable_objects: z
          .object({
            bindings: z.array(
              z.object({
                class_name: z.string(),
                name: z.string(),
                script_name: z.string().optional(),
              })
            ),
          })
          .optional(),
        hyperdrive: z
          .array(
            z.object({
              binding: z.string(),
              id: z.string(),
              localConnectionString: z.string().optional(),
            })
          )
          .optional(),
        main: z.string().optional(),
        name: z.string().optional(),
        r2_buckets: z
          .array(z.object({ binding: z.string(), bucket_name: z.string() }))
          .optional(),
        services: z
          .array(
            z.object({
              binding: z.string(),
              entrypoint: z.string().optional(),
              service: z.string(),
            })
          )
          .optional(),
        vars: z.record(z.string(), z.json()).optional(),
      })
      .parse(unstable_readConfig({ config: configPath }));
    const env: NonNullable<WorkerConfig["env"]> = {};
    for (const [name, value] of Object.entries(config.vars ?? {})) {
      env[name] =
        typeof value === "string"
          ? bindings.text(value)
          : bindings.json(z.json().parse(value));
    }
    for (const binding of config.hyperdrive ?? []) {
      env[binding.binding] = bindings.hyperdrive({
        dev: { connectionString: binding.localConnectionString },
        id: binding.id,
      });
    }
    for (const binding of config.durable_objects?.bindings ?? []) {
      env[binding.name] = bindings.durableObject({
        exportName: binding.class_name,
        worker: binding.script_name ?? config.name ?? "quieter-site",
      });
    }
    for (const binding of config.r2_buckets ?? []) {
      env[binding.binding] = bindings.r2({ name: binding.bucket_name });
    }
    for (const binding of config.services ?? []) {
      env[binding.binding] = bindings.worker({
        exportName: binding.entrypoint,
        worker: binding.service,
      });
    }
    return {
      worker: {
        compatibilityDate: COMPATIBILITY_DATE,
        compatibilityFlags: config.compatibility_flags,
        entrypoint:
          config.main ??
          fileURLToPath(new URL("src/server.ts", import.meta.url)),
        env,
        name: config.name ?? "quieter-site",
      },
    };
  }
  const localValues = loadEnv(
    mode ?? "development",
    fileURLToPath(new URL("../..", import.meta.url)),
    ""
  );
  const localBindings = Object.fromEntries(
    Object.keys(createServerEnv(localValues))
      .filter(
        (name) =>
          name !== "DATABASE_MIGRATION_URL" && localValues[name] !== undefined
      )
      .map((name) => [name, bindings.secret()])
  );
  return {
    worker: {
      compatibilityDate: COMPATIBILITY_DATE,
      compatibilityFlags: ["nodejs_compat"],
      entrypoint: "src/server.ts",
      env: localBindings,
      name: "quieter-local-site",
    },
  };
});
