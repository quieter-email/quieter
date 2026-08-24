import { createMailboxActionResources } from "./actions";
import { createAppDatabase } from "./database";
import { createGmailResources } from "./gmail";
import { createMailResources, mailReceiptRuleSetName } from "./mail";
import { createDeploymentContext } from "./runtime";
import { requireSecretResource } from "./secrets";
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
  const webAssetArchive = new sst.cloudflare.Bucket("WebAssetArchive");
  const actions = createMailboxActionResources(
    context,
    secretBindings,
    appDatabase
  );
  const gmail = createGmailResources(
    context,
    secretBindings,
    secretResources,
    appDatabase,
    actions.mailboxActionQueue
  );
  const mail = await createMailResources(context, secretResources);
  const web = createWeb(
    appDatabase,
    webSecretBindings,
    {
      GMAIL_LIVE_SYNC_URL: gmail.gmailLiveSyncUrl,
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
    [mail.mailBucket, mail.webAwsPermissions, webAssetArchive]
  );

  return {
    gmailLiveSyncTokenSecretName: requireSecretResource(
      secretResources,
      "GMAIL_LIVE_SYNC_TOKEN_SECRET"
    ).name,
    gmailLiveSyncUrl: gmail.gmailLiveSyncUrl,
    gmailPubSubIngressUrl: gmail.gmailPubSubIngressUrl,
    gmailPubSubPushAudience:
      context.gmailPubSubEnvironment.GMAIL_PUBSUB_PUSH_AUDIENCE || null,
    mailBucket: mail.mailBucket.name,
    mailIngestTokenSecretName: mail.mailIngressToken.name,
    mailIngressUrl: mail.mailIngress.url,
    mailOutboundConfigurationSetName:
      mail.mailOutboundConfigurationSet.configurationSetName,
    mailOutboundFeedbackDeadLetterQueueUrl:
      mail.mailOutboundFeedbackDeadLetterQueue.url,
    mailOutboundFeedbackTopicArn: mail.mailOutboundFeedbackTopic.arn,
    mailReceiptRoleArn: mail.mailReceiptRole.arn,
    mailReceiptRuleSetName,
    mailReceiptTopicArn: mail.mailReceiptTopic.arn,
    stage: $app.stage,
    webAssetArchiveBucket: webAssetArchive.name,
    webUrl: web.url,
  };
};
