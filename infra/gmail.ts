import { COMPATIBILITY_DATE } from "@quieter/cloudflare/compatibility-date";

import { cloudflareWorkerObservability } from "./runtime";
import type { DeploymentContext } from "./runtime";
import { requireSecretResource } from "./secrets";
import type { SecretResources } from "./types";

export const createGmailResources = (
  context: DeploymentContext,
  secretResources: SecretResources,
  memoryServiceUrl: $util.Input<string>
) => {
  const gmailLiveSyncTokenSecret = requireSecretResource(
    secretResources,
    "GMAIL_LIVE_SYNC_TOKEN_SECRET"
  );
  const gmailLiveSyncConnections = new sst.aws.Dynamo(
    "GmailLiveSyncConnections",
    {
      fields: {
        connectionId: "string",
        mailboxId: "string",
      },
      globalIndexes: {
        mailboxId: { hashKey: "mailboxId", projection: "keys-only" },
      },
      primaryIndex: { hashKey: "connectionId" },
      ttl: "expiresAt",
    }
  );
  const gmailLiveSyncApi = new sst.aws.ApiGatewayWebSocket("GmailLiveSyncApi");
  const gmailLiveSyncHandler = new sst.aws.Function(
    "GmailLiveSyncWebSocketHandler",
    {
      environment: {
        DATABASE_URL: context.databaseUrl,
        POLAR_ACCESS_TOKEN: context.polarAccessToken,
        POLAR_ORGANIZATION_ID: context.polarOrganizationId,
        POLAR_SANDBOX: context.polarSandbox,
        ...context.sentryEnvironment,
      },
      handler: "packages/aws/src/gmail-live-sync-websocket.handler",
      link: [gmailLiveSyncConnections, gmailLiveSyncTokenSecret],
      timeout: "30 seconds",
    }
  );
  gmailLiveSyncApi.route("$connect", gmailLiveSyncHandler.arn);
  gmailLiveSyncApi.route("$disconnect", gmailLiveSyncHandler.arn);
  gmailLiveSyncApi.route("ping", gmailLiveSyncHandler.arn);

  let gmailLiveSyncUrl: $util.Output<string> = gmailLiveSyncApi.url;
  let gmailPubSubIngressUrl: $util.Output<string> | null = null;
  let gmailPubSubProcessUrl: $util.Output<string> | null = null;
  let gmailPubSubProcessTokenSecretName: $util.Input<string> | null = null;

  if (context.gmailPubSubEnabled) {
    const gmailPubSubProcessToken = requireSecretResource(
      secretResources,
      "GMAIL_PUBSUB_PROCESS_TOKEN"
    );
    gmailPubSubProcessTokenSecretName = gmailPubSubProcessToken.name;
    const gmailPubSubDeadLetterQueue = new sst.aws.Queue(
      "GmailPubSubDeadLetterQueue",
      {
        fifo: true,
        transform: {
          queue: {
            messageRetentionSeconds: 60 * 60 * 24 * 14,
          },
        },
      }
    );
    const gmailPubSubQueue = new sst.aws.Queue("GmailPubSubQueue", {
      dlq: {
        queue: gmailPubSubDeadLetterQueue.arn,
        retry: 10,
      },
      fifo: true,
      transform: {
        queue: {
          messageRetentionSeconds: 60 * 60 * 24 * 14,
        },
      },
      visibilityTimeout: "15 minutes",
    });
    gmailPubSubQueue.subscribe(
      {
        environment: {
          AI_MEMORY_SERVICE_TOKEN: context.aiMemoryServiceToken,
          AI_MEMORY_SERVICE_URL: memoryServiceUrl,
          DATABASE_URL: context.databaseUrl,
          GMAIL_PUBSUB_TOPIC: context.gmailPubSubEnvironment.GMAIL_PUBSUB_TOPIC,
          GMAIL_TOKEN_ENCRYPTION_KEY: context.gmailTokenEncryptionKey,
          GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT:
            context.gmailTokenEncryptionKeyCurrent,
          GOOGLE_GMAIL_CLIENT_ID: context.googleGmailClientId,
          GOOGLE_GMAIL_CLIENT_SECRET: context.googleGmailClientSecret,
          OPENROUTER_API_KEY: context.openRouterApiKey,
          POLAR_ACCESS_TOKEN: context.polarAccessToken,
          POLAR_ORGANIZATION_ID: context.polarOrganizationId,
          POLAR_SANDBOX: context.polarSandbox,
          QUIETER_GMAIL_AI_AUTOMATION_ENABLED: context.mailAutomationAiEnabled,
          ...context.sentryEnvironment,
        },
        handler: "packages/aws/src/gmail-pubsub-consumer.handler",
        link: [gmailLiveSyncApi, gmailLiveSyncConnections],
        timeout: "15 minutes",
      },
      {
        batch: {
          partialResponses: true,
          size: 1,
        },
      }
    );

    const gmailPubSubIngress = new sst.aws.ApiGatewayV2("GmailPubSubIngress", {
      cors: false,
      domain:
        $app.stage === "production"
          ? {
              dns: sst.cloudflare.dns(),
              name: "gmail-events.quieter.email",
            }
          : undefined,
    });
    gmailPubSubIngress.route("POST /", {
      environment: {
        DATABASE_URL: context.databaseUrl,
        ...context.gmailPubSubEnvironment,
        GMAIL_PUBSUB_QUEUE_URL: gmailPubSubQueue.url,
        ...context.sentryEnvironment,
      },
      handler: "packages/aws/src/gmail-pubsub-ingress.handler",
      link: [gmailPubSubQueue, gmailLiveSyncApi, gmailLiveSyncConnections],
      timeout: "30 seconds",
    });
    gmailPubSubIngressUrl = gmailPubSubIngress.url;

    const gmailPubSubMaintenance = new sst.aws.CronV2(
      "GmailPubSubMaintenance",
      {
        function: {
          environment: {
            DATABASE_URL: context.databaseUrl,
            GMAIL_PUBSUB_QUEUE_URL: gmailPubSubQueue.url,
            ...context.sentryEnvironment,
          },
          handler: "packages/aws/src/gmail-pubsub-maintenance.handler",
          link: [gmailPubSubQueue],
          timeout: "5 minutes",
        },
        schedule: "rate(15 minutes)",
      }
    );
    void gmailPubSubMaintenance;

    const gmailPubSubProcess = new sst.aws.Function("GmailPubSubProcess", {
      environment: {
        AI_MEMORY_SERVICE_TOKEN: context.aiMemoryServiceToken,
        AI_MEMORY_SERVICE_URL: memoryServiceUrl,
        DATABASE_URL: context.databaseUrl,
        GMAIL_PUBSUB_PROCESS_TOKEN: gmailPubSubProcessToken.value,
        GMAIL_TOKEN_ENCRYPTION_KEY: context.gmailTokenEncryptionKey,
        GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT:
          context.gmailTokenEncryptionKeyCurrent,
        GOOGLE_GMAIL_CLIENT_ID: context.googleGmailClientId,
        GOOGLE_GMAIL_CLIENT_SECRET: context.googleGmailClientSecret,
        OPENROUTER_API_KEY: context.openRouterApiKey,
        POLAR_ACCESS_TOKEN: context.polarAccessToken,
        POLAR_ORGANIZATION_ID: context.polarOrganizationId,
        POLAR_SANDBOX: context.polarSandbox,
        QUIETER_GMAIL_AI_AUTOMATION_ENABLED: context.mailAutomationAiEnabled,
        ...context.sentryEnvironment,
      },
      handler: "packages/aws/src/gmail-pubsub-process.handler",
      link: [
        gmailLiveSyncApi,
        gmailLiveSyncConnections,
        gmailPubSubProcessToken,
      ],
      timeout: "15 minutes",
      url: true,
    });
    gmailPubSubProcessUrl = gmailPubSubProcess.url;

    const gmailPubSubCloudflareDeadLetterQueue = new sst.cloudflare.Queue(
      "GmailPsDlq"
    );
    const gmailPubSubCloudflareQueue = new sst.cloudflare.Queue(
      "GmailPsQueue",
      {
        dlq: {
          queue: gmailPubSubCloudflareDeadLetterQueue.nodes.queue.queueName,
          retry: 10,
        },
        maxConcurrency: 20,
      }
    );
    const gmailLiveSyncMailbox = new sst.cloudflare.DurableObject(
      "GmailLiveSyncMailbox",
      {
        className: "GmailLiveSyncMailbox",
      }
    );
    const gmailRealtimeWorker = new sst.cloudflare.Worker(
      "GmailRealtimeWorker",
      {
        compatibility: {
          date: COMPATIBILITY_DATE,
          flags: ["nodejs_compat"],
        },
        environment: {
          GMAIL_PUBSUB_PROCESS_URL: gmailPubSubProcess.url,
          GMAIL_PUBSUB_PUSH_AUDIENCE:
            context.gmailPubSubEnvironment.GMAIL_PUBSUB_PUSH_AUDIENCE,
          GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT:
            context.gmailPubSubEnvironment.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT,
          GMAIL_PUBSUB_SUBSCRIPTION:
            context.gmailPubSubEnvironment.GMAIL_PUBSUB_SUBSCRIPTION,
        },
        handler: "packages/cloudflare/src/worker.ts",
        link: [
          gmailLiveSyncMailbox,
          gmailLiveSyncTokenSecret,
          gmailPubSubCloudflareQueue,
          gmailPubSubProcessToken,
        ],
        migrations: [
          {
            newSqliteClasses: [gmailLiveSyncMailbox.className],
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
    gmailPubSubCloudflareQueue.subscribe(
      {
        environment: {
          GMAIL_PUBSUB_PROCESS_URL: gmailPubSubProcess.url,
        },
        handler: "packages/cloudflare/src/worker.ts",
        link: [gmailPubSubProcessToken],
        transform: {
          worker(args) {
            args.observability = cloudflareWorkerObservability;
          },
        },
      },
      {
        batch: {
          size: 1,
          window: "0 seconds",
        },
      }
    );
    gmailLiveSyncUrl = gmailRealtimeWorker.url.apply((url) => {
      if (url === undefined || url === "") {
        throw new Error("GmailRealtimeWorker did not expose a URL");
      }

      return `${url.replace(/^http/u, "ws")}/gmail/live`;
    });
    gmailPubSubIngressUrl = gmailRealtimeWorker.url.apply((url) => {
      if (url === undefined || url === "") {
        throw new Error("GmailRealtimeWorker did not expose a URL");
      }

      return `${url}/gmail/pubsub`;
    });
  }

  return {
    gmailLiveSyncConnections,
    gmailLiveSyncUrl,
    gmailPubSubIngressUrl,
    gmailPubSubProcessTokenSecretName,
    gmailPubSubProcessUrl,
  };
};
