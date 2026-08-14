import { COMPATIBILITY_DATE } from "@quieter/cloudflare/compatibility-date";

import type { createAppDatabase } from "./database";
import { cloudflareWorkerObservability } from "./runtime";
import { requireSecretResource } from "./secrets";
import { production } from "./stage";
import type { SecretResources, SstLinkable } from "./types";

const memoryVectorIndexName = production
  ? "quieter-ai-memory-production-v1"
  : "quieter-ai-memory-development-v1";

export const createAiMemoryResources = (
  secretResources: SecretResources,
  secretBindings: SstLinkable[],
  appDatabase: ReturnType<typeof createAppDatabase>
) => {
  const serviceToken = requireSecretResource(
    secretResources,
    "AI_MEMORY_SERVICE_TOKEN"
  );
  const worker = new sst.cloudflare.Worker("AiMemoryWorker", {
    compatibility: {
      date: COMPATIBILITY_DATE,
      flags: ["nodejs_compat"],
    },
    handler: "packages/cloudflare/src/ai-memory-worker.ts",
    link: [appDatabase, serviceToken, ...secretBindings],
    transform: {
      worker(args) {
        args.bindings = $resolve([args.bindings]).apply(([bindings]) => [
          ...(bindings ?? []),
          { name: "AI", type: "ai" },
          {
            indexName: memoryVectorIndexName,
            name: "AI_MEMORY_VECTOR",
            type: "vectorize",
          },
        ]);
        args.observability = cloudflareWorkerObservability;
      },
    },
    url: true,
  });

  const indexCron = new sst.cloudflare.Cron("AiMemoryIndexCron", {
    schedules: ["*/5 * * * *"],
    worker: {
      compatibility: {
        date: COMPATIBILITY_DATE,
        flags: ["nodejs_compat"],
      },
      handler: "packages/cloudflare/src/ai-memory-worker.ts",
      link: [appDatabase, serviceToken, ...secretBindings],
      transform: {
        worker(args) {
          args.bindings = $resolve([args.bindings]).apply(([bindings]) => [
            ...(bindings ?? []),
            { name: "AI", type: "ai" },
            {
              indexName: memoryVectorIndexName,
              name: "AI_MEMORY_VECTOR",
              type: "vectorize",
            },
          ]);
          args.observability = cloudflareWorkerObservability;
        },
      },
    },
  });
  void indexCron;

  return { memoryVectorIndexName, serviceToken, worker };
};
