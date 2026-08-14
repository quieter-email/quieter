import { COMPATIBILITY_DATE } from "@quieter/cloudflare/compatibility-date";

import type { createAppDatabase } from "./database";
import { cloudflareWorkerObservability } from "./runtime";
import type { DeploymentContext } from "./runtime";
import { requireSecretResource } from "./secrets";
import { deploymentEnvironment } from "./stage";
import type { SecretResources, SstLinkable } from "./types";

export const createChatResources = (
  context: DeploymentContext,
  secretResources: SecretResources,
  secretBindings: SstLinkable[],
  appDatabase: ReturnType<typeof createAppDatabase>
) => {
  const chatGenerationStartToken = requireSecretResource(
    secretResources,
    "CHAT_GENERATION_START_TOKEN"
  );
  const chatRunSession = new sst.cloudflare.DurableObject("ChatRunSession", {
    className: "ChatRunSession",
  });
  const chatGenerationWorker = new sst.cloudflare.Worker(
    "ChatGenerationWorker",
    {
      compatibility: {
        date: COMPATIBILITY_DATE,
        flags: ["nodejs_compat"],
      },
      environment: {
        POLAR_ORGANIZATION_ID: context.polarOrganizationId,
        POLAR_SANDBOX: context.polarSandbox,
        QUIETER_DEPLOYMENT_ENV: deploymentEnvironment,
        SENTRY_ENVIRONMENT: context.sentryEnvironment.SENTRY_ENVIRONMENT,
      },
      handler: "packages/cloudflare/src/chat-generation-worker.ts",
      link: [
        appDatabase,
        chatGenerationStartToken,
        chatRunSession,
        ...secretBindings,
      ],
      migrations: [
        {
          newSqliteClasses: [chatRunSession.className],
          tag: "v1",
        },
      ],
      transform: {
        worker(args) {
          args.observability = cloudflareWorkerObservability;
        },
      },
      url: true,
    }
  );

  return { chatGenerationStartToken, chatGenerationWorker, chatRunSession };
};
