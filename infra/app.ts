import { createMailboxActionResources } from "./actions";
import { createChatResources } from "./chat";
import { createAppDatabase } from "./database";
import { createGmailResources } from "./gmail";
import { createMailResources, mailReceiptRuleSetName } from "./mail";
import { createAiMemoryResources } from "./memory";
import { createDeploymentContext, requireWorkerUrl } from "./runtime";
import { requireSecretResource, selectSecretBindings } from "./secrets";
import type { SecretBindings, SecretResources } from "./types";
import { createWeb } from "./web";

export const createInfrastructure = async (input: {
  secretBindings: SecretBindings;
  secretResources: SecretResources;
}) => {
  const { secretBindings, secretResources } = input;
  const appDatabase = createAppDatabase(
    requireSecretResource(secretResources, "DATABASE_URL")
  );
  const webSecretBindings = Object.values(secretBindings);

  const context = createDeploymentContext(secretResources);
  const memory = createAiMemoryResources(
    secretResources,
    selectSecretBindings(secretBindings, ["SENTRY_DSN"]),
    appDatabase
  );
  const memoryServiceUrl = requireWorkerUrl(
    memory.worker.url,
    "AiMemoryWorker"
  );
  const chat = createChatResources(
    context,
    secretResources,
    selectSecretBindings(secretBindings, [
      "CONNECTOR_TOKEN_ENCRYPTION_KEY",
      "AI_MEMORY_SERVICE_TOKEN",
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
      "SENTRY_DSN",
    ]),
    appDatabase,
    memoryServiceUrl
  );
  const actions = createMailboxActionResources(context, memoryServiceUrl);
  const gmail = createGmailResources(
    context,
    secretResources,
    memoryServiceUrl
  );
  const mail = await createMailResources(context, secretResources);
  const web = createWeb(
    appDatabase,
    webSecretBindings,
    {
      AI_MEMORY_SERVICE_URL: memoryServiceUrl,
      CHAT_GENERATION_START_URL: requireWorkerUrl(
        chat.chatGenerationWorker.url,
        "ChatGenerationWorker"
      ),
      GMAIL_LIVE_SYNC_URL: gmail.gmailLiveSyncUrl,
      MAILBOX_ACTION_QUEUE_URL: actions.mailboxActionQueue.url,
      MAIL_BUCKET: mail.mailBucket.name,
      MAIL_RECEIPT_ROLE_ARN: mail.mailReceiptRole.arn,
      MAIL_RECEIPT_RULE_SET_NAME: mailReceiptRuleSetName,
      MAIL_RECEIPT_TOPIC_ARN: mail.mailReceiptTopic.arn,
      POLAR_ORGANIZATION_ID: context.polarOrganizationId,
      POLAR_PRODUCT_MANAGED_ID: context.polarProductManagedId,
      POLAR_PRODUCT_PRO_ID: context.polarProductProId,
      POLAR_SANDBOX: context.polarSandbox,
      QUIETER_GMAIL_AI_AUTOMATION_ENABLED: context.mailAutomationAiEnabled,
      R2_ACCOUNT_ID: context.env.R2_ACCOUNT_ID ?? "",
      R2_BUCKET: context.env.R2_BUCKET ?? "",
      R2_ENDPOINT: context.env.R2_ENDPOINT ?? "",
      SES_CONFIGURATION_SET_NAME:
        mail.mailOutboundConfigurationSet.configurationSetName,
    },
    [mail.mailBucket, mail.webAwsPermissions]
  );

  return {
    aiMemoryServiceTokenSecretName: memory.serviceToken.name,
    aiMemoryServiceUrl: memory.worker.url,
    aiMemoryVectorIndexName: memory.memoryVectorIndexName,
    chatGenerationStartTokenSecretName: requireSecretResource(
      secretResources,
      "CHAT_GENERATION_START_TOKEN"
    ).name,
    chatGenerationWorkerUrl: chat.chatGenerationWorker.url,
    gmailLiveSyncTokenSecretName: requireSecretResource(
      secretResources,
      "GMAIL_LIVE_SYNC_TOKEN_SECRET"
    ).name,
    gmailLiveSyncUrl: gmail.gmailLiveSyncUrl,
    gmailPubSubIngressUrl: gmail.gmailPubSubIngressUrl,
    gmailPubSubProcessTokenSecretName: gmail.gmailPubSubProcessTokenSecretName,
    gmailPubSubProcessUrl: gmail.gmailPubSubProcessUrl,
    gmailPubSubPushAudience:
      context.gmailPubSubEnvironment.GMAIL_PUBSUB_PUSH_AUDIENCE || null,
    mailBucket: mail.mailBucket.name,
    mailIngestTokenSecretName: mail.mailIngressToken.name,
    mailIngressUrl: mail.mailIngress.url,
    mailOutboundConfigurationSetName:
      mail.mailOutboundConfigurationSet.configurationSetName,
    mailOutboundFeedbackDeadLetterQueueUrl:
      mail.mailOutboundFeedbackDeadLetterQueue.url,
    mailOutboundFeedbackQueueUrl: mail.mailOutboundFeedbackQueue.url,
    mailOutboundFeedbackTopicArn: mail.mailOutboundFeedbackTopic.arn,
    mailReceiptRoleArn: mail.mailReceiptRole.arn,
    mailReceiptRuleSetName,
    mailReceiptTopicArn: mail.mailReceiptTopic.arn,
    mailboxActionQueueUrl: actions.mailboxActionQueue.url,
    stage: $app.stage,
    webUrl: web.url,
  };
};
