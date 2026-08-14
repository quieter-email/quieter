import type { DeploymentContext } from "./runtime";

export const createMailboxActionResources = (
  context: DeploymentContext,
  memoryServiceUrl: $util.Input<string>
) => {
  const mailboxActionDeadLetterQueue = new sst.aws.Queue(
    "MailboxActionDeadLetterQueue",
    {
      transform: {
        queue: {
          messageRetentionSeconds: 60 * 60 * 24 * 14,
        },
      },
    }
  );
  const mailboxActionQueue = new sst.aws.Queue("MailboxActionQueue", {
    dlq: {
      queue: mailboxActionDeadLetterQueue.arn,
      retry: 5,
    },
    transform: {
      queue: {
        messageRetentionSeconds: 60 * 60 * 24 * 14,
      },
    },
    visibilityTimeout: "20 minutes",
  });

  mailboxActionQueue.subscribe(
    {
      environment: {
        AI_MEMORY_SERVICE_TOKEN: context.aiMemoryServiceToken,
        AI_MEMORY_SERVICE_URL: memoryServiceUrl,
        CONNECTOR_TOKEN_ENCRYPTION_KEY: context.connectorTokenEncryptionKey,
        DATABASE_URL: context.databaseUrl,
        GMAIL_TOKEN_ENCRYPTION_KEY: context.gmailTokenEncryptionKey,
        GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT:
          context.gmailTokenEncryptionKeyCurrent,
        GOOGLE_GMAIL_CLIENT_ID: context.googleGmailClientId,
        GOOGLE_GMAIL_CLIENT_SECRET: context.googleGmailClientSecret,
        LINEAR_CLIENT_ID: context.linearClientId,
        LINEAR_CLIENT_SECRET: context.linearClientSecret,
        OPENROUTER_API_KEY: context.openRouterApiKey,
        POLAR_ACCESS_TOKEN: context.polarAccessToken,
        POLAR_ORGANIZATION_ID: context.polarOrganizationId,
        POLAR_SANDBOX: context.polarSandbox,
        ...context.sentryEnvironment,
      },
      handler: "packages/aws/src/mailbox-action-consumer.handler",
      timeout: "15 minutes",
    },
    {
      batch: {
        partialResponses: true,
        size: 1,
      },
    }
  );

  return { mailboxActionDeadLetterQueue, mailboxActionQueue };
};
