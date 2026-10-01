import { fileURLToPath } from "node:url";

import { createServerEnv } from "@quieter/env/server";
import { bindings, defineConfig } from "cf/config";
import type { WorkerConfig } from "cf/config";
import { loadEnv } from "vite";
import { unstable_readConfig } from "wrangler";
import { z } from "zod";

import { COMPATIBILITY_DATE } from "../../packages/cloudflare/src/compatibility-date.ts";

export default defineConfig(({ mode }) => {
  // SST supplies resolved links and bindings to the build through this file.
  const configPath = process.env.SST_WRANGLER_PATH;
  if (configPath) {
    const config = z
      .object({
        compatibility_flags: z.array(z.string()),
        durable_objects: z.object({
          bindings: z.array(
            z.object({
              class_name: z.string(),
              name: z.string(),
              script_name: z.string().optional(),
            })
          ),
        }),
        hyperdrive: z.array(
          z.object({
            binding: z.string(),
            id: z.string(),
            localConnectionString: z.string().optional(),
          })
        ),
        main: z.string().optional(),
        name: z.string().optional(),
        r2_buckets: z.array(
          z.object({ binding: z.string(), bucket_name: z.string() })
        ),
        services: z.array(
          z.object({
            binding: z.string(),
            entrypoint: z.string().optional(),
            service: z.string(),
          })
        ),
        vars: z.record(z.string(), z.json()),
      })
      .parse(unstable_readConfig({ config: configPath }));
    const env: NonNullable<WorkerConfig["env"]> = {};
    for (const [name, value] of Object.entries(config.vars)) {
      env[name] =
        typeof value === "string"
          ? bindings.text(value)
          : bindings.json(z.json().parse(value));
    }
    for (const binding of config.hyperdrive) {
      env[binding.binding] = bindings.hyperdrive({
        dev: { connectionString: binding.localConnectionString },
        id: binding.id,
      });
    }
    for (const binding of config.durable_objects.bindings) {
      env[binding.name] = bindings.durableObject({
        exportName: binding.class_name,
        worker: binding.script_name ?? config.name ?? "quieter-web",
      });
    }
    for (const binding of config.r2_buckets) {
      env[binding.binding] = bindings.r2({ name: binding.bucket_name });
    }
    for (const binding of config.services) {
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
        name: config.name ?? "quieter-web",
      },
    };
  }
  const localValues = loadEnv(
    mode ?? "development",
    fileURLToPath(new URL("../..", import.meta.url)),
    ""
  );
  // The plugin resolves local values only for declared secret bindings.
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
      env: {
        ...localBindings,
        LocalMailStorage: bindings.r2({
          dev: { remote: false },
          name: "quieter-local-mail",
        }),
      },
      name: "quieter-local-web",
    },
  };
});
