import { COMPATIBILITY_DATE } from "@quieter/cloudflare/compatibility-date";

import type { createAppDatabase } from "./database";
import { cloudflareWorkerObservability } from "./runtime";
import type { DeploymentContext } from "./runtime";
import { requireSecretBinding } from "./secrets";
import type { SecretBindings } from "./types";

const actionSecretNames = [
  "CONNECTOR_TOKEN_ENCRYPTION_KEY",
  "GMAIL_TOKEN_ENCRYPTION_KEY",
  "GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT",
  "GOOGLE_CALENDAR_CLIENT_ID",
  "GOOGLE_CALENDAR_CLIENT_SECRET",
  "GOOGLE_GMAIL_CLIENT_ID",
  "GOOGLE_GMAIL_CLIENT_SECRET",
  "LINEAR_CLIENT_ID",
  "LINEAR_CLIENT_SECRET",
  "OPENROUTER_API_KEY",
  "POLAR_ACCESS_TOKEN",
] as const;

export const createMailboxActionResources = (
  context: DeploymentContext,
  secretBindings: SecretBindings,
  appDatabase: ReturnType<typeof createAppDatabase>
) => {
  const deadLetterQueue = new sst.cloudflare.Queue(
    "MailboxActionDeadLetterQueue"
  );
  const queue = new sst.cloudflare.Queue("MailboxActionQueue", {
    dlq: {
      queue: deadLetterQueue.nodes.queue.queueName,
      retry: 5,
      retryDelay: "30 seconds",
    },
    maxConcurrency: 5,
  });
  const actionSecretBindings = actionSecretNames.map((name) =>
    requireSecretBinding(secretBindings, name)
  );

  queue.subscribe(
    {
      compatibility: {
        date: COMPATIBILITY_DATE,
        flags: ["nodejs_compat"],
      },
      environment: {
        POLAR_ORGANIZATION_ID: context.polarOrganizationId,
        POLAR_SANDBOX: context.polarSandbox,
        SENTRY_ENVIRONMENT: context.sentryEnvironment.SENTRY_ENVIRONMENT,
      },
      handler: "packages/cloudflare/src/mailbox-action-worker.ts",
      link: [appDatabase, ...actionSecretBindings],
      transform: {
        worker(args) {
          args.limits = { cpuMs: 300_000 };
          args.observability = cloudflareWorkerObservability;
        },
      },
    },
    {
      batch: { size: 1, window: "0 seconds" },
    }
  );

  const dispatch = new sst.cloudflare.Cron("MailboxActionDispatch", {
    schedules: ["* * * * *"],
    worker: {
      compatibility: {
        date: COMPATIBILITY_DATE,
        flags: ["nodejs_compat"],
      },
      handler: "packages/cloudflare/src/mailbox-action-dispatch-worker.ts",
      link: [appDatabase, queue],
      transform: {
        worker(args) {
          args.observability = cloudflareWorkerObservability;
        },
      },
    },
  });
  void dispatch;

  return { mailboxActionQueue: queue };
};
