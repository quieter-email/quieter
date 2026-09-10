import { createAppDatabase } from "./database";
import { createGmailResources } from "./gmail";
import { createMailResources, mailReceiptRuleSetName } from "./mail";
import { createMailMaintenanceResources } from "./mail-maintenance";
import { createDeploymentContext } from "./runtime";
import { requireSecretResource } from "./secrets";
import { createMailSyncResources } from "./sync";
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
  const sync = createMailSyncResources(
    context,
    secretBindings,
    secretResources,
    appDatabase
  );
  createMailMaintenanceResources(context, secretBindings, appDatabase, sync);
  const gmail = createGmailResources(
    context,
    secretBindings,
    secretResources,
    appDatabase,
    sync
  );
  const mail = await createMailResources(context, secretResources, sync);
  const web = createWeb(
    appDatabase,
    webSecretBindings,
    {
      ...sync.environment,
      MAIL_BUCKET: mail.mailBucket.name,
      MAIL_RECEIPT_ROLE_ARN: mail.mailReceiptRole.arn,
      MAIL_RECEIPT_RULE_SET_NAME: mailReceiptRuleSetName,
      MAIL_RECEIPT_TOPIC_ARN: mail.mailReceiptTopic.arn,
      ...context.billingEnvironment,
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
    mailSyncUrl: sync.url,
    stage: $app.stage,
    webUrl: web.url,
  };
};
