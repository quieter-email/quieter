import type { DeploymentContext } from "./runtime";
import { requireSecretResource } from "./secrets";
import { deploymentEnvironment } from "./stage";
import type { SecretResources } from "./types";

const mailObjectKeyPrefix = "mail/inbound/";
export const mailReceiptRuleSetName = "quieter-mail";

export const createMailResources = async (
  context: DeploymentContext,
  secretResources: SecretResources
) => {
  const callerIdentity = await aws.getCallerIdentity({});
  const region = await aws.getRegion({});
  const mailReceiptRuleSourceArn = `arn:aws:ses:${region.region}:${callerIdentity.accountId}:receipt-rule-set/${mailReceiptRuleSetName}:receipt-rule/*`;
  const mailBucket = new sst.aws.Bucket("MailBucket", {
    policy: [
      {
        actions: ["s3:PutObject"],
        conditions: [
          {
            test: "StringEquals",
            values: [callerIdentity.accountId],
            variable: "aws:SourceAccount",
          },
          {
            test: "ArnLike",
            values: [mailReceiptRuleSourceArn],
            variable: "aws:SourceArn",
          },
        ],
        paths: [`${mailObjectKeyPrefix}*`],
        principals: [
          {
            identifiers: ["ses.amazonaws.com"],
            type: "service",
          },
        ],
      },
    ],
  });
  // Keep the existing Pulumi resource type to avoid changing the deployed resource identity.
  // oxlint-disable-next-line eslint/no-deprecated
  const mailBucketLifecycle = new aws.s3.BucketLifecycleConfigurationV2(
    "MailBucketLifecycle",
    {
      bucket: mailBucket.name,
      rules: [
        {
          expiration: {
            days: 1,
          },
          filter: {
            prefix: mailObjectKeyPrefix,
          },
          id: "expire-ses-landing-objects",
          status: "Enabled",
        },
      ],
    }
  );

  const mailReceiptTopic = new sst.aws.SnsTopic("MailReceiptTopic");
  const mailReceiptRole = new aws.iam.Role("MailReceiptRole", {
    assumeRolePolicy: $jsonStringify({
      Statement: [
        {
          Action: "sts:AssumeRole",
          Condition: {
            ArnLike: {
              "aws:SourceArn": mailReceiptRuleSourceArn,
            },
            StringEquals: {
              "aws:SourceAccount": callerIdentity.accountId,
            },
          },
          Effect: "Allow",
          Principal: {
            Service: "ses.amazonaws.com",
          },
        },
      ],
      Version: "2012-10-17",
    }),
  });
  const mailReceiptRolePolicy = new aws.iam.RolePolicy(
    "MailReceiptRolePolicy",
    {
      policy: $jsonStringify({
        Statement: [
          {
            Action: ["s3:PutObject"],
            Effect: "Allow",
            Resource: [
              mailBucket.arn.apply((arn) => `${arn}/${mailObjectKeyPrefix}*`),
            ],
          },
          {
            Action: ["sns:Publish"],
            Effect: "Allow",
            Resource: [mailReceiptTopic.arn],
          },
        ],
        Version: "2012-10-17",
      }),
      role: mailReceiptRole.id,
    }
  );

  void mailBucketLifecycle;
  void mailReceiptRolePolicy;

  const mailOutboundConfigurationSet = new aws.sesv2.ConfigurationSet(
    "MailOutboundConfigurationSet",
    {
      configurationSetName: `quieter-${$app.stage}-outbound`,
      reputationOptions: {
        reputationMetricsEnabled: true,
      },
      sendingOptions: {
        sendingEnabled: true,
      },
      suppressionOptions: {
        suppressedReasons: ["BOUNCE", "COMPLAINT"],
      },
    }
  );
  const mailOutboundFeedbackTopic = new sst.aws.SnsTopic(
    "MailOutboundFeedbackTopic"
  );
  const mailOutboundFeedbackTopicPolicy = new aws.sns.TopicPolicy(
    "MailOutboundFeedbackTopicPolicy",
    {
      arn: mailOutboundFeedbackTopic.arn,
      policy: $jsonStringify({
        Statement: [
          {
            Action: "sns:Publish",
            Condition: {
              StringEquals: {
                "aws:SourceAccount": callerIdentity.accountId,
              },
            },
            Effect: "Allow",
            Principal: {
              Service: "ses.amazonaws.com",
            },
            Resource: mailOutboundFeedbackTopic.arn,
            Sid: "AllowSesFeedbackPublishing",
          },
        ],
        Version: "2012-10-17",
      }),
    }
  );
  const mailOutboundFeedbackDeadLetterQueue = new sst.aws.Queue(
    "MailOutboundFeedbackDeadLetterQueue",
    {
      transform: {
        queue: {
          messageRetentionSeconds: 60 * 60 * 24 * 14,
        },
      },
    }
  );
  const mailOutboundFeedbackDeadLetterAlarm = new aws.cloudwatch.MetricAlarm(
    "MailOutboundFeedbackDeadLetterAlarm",
    {
      alarmDescription:
        "Outbound mail feedback could not be processed after retries.",
      comparisonOperator: "GreaterThanThreshold",
      dimensions: {
        QueueName: mailOutboundFeedbackDeadLetterQueue.nodes.queue.name,
      },
      evaluationPeriods: 1,
      metricName: "ApproximateNumberOfMessagesVisible",
      namespace: "AWS/SQS",
      period: 300,
      statistic: "Maximum",
      threshold: 0,
      treatMissingData: "notBreaching",
    }
  );
  const mailOutboundFeedbackEventDestination =
    new aws.sesv2.ConfigurationSetEventDestination(
      "MailOutboundFeedbackEventDestination",
      {
        configurationSetName: mailOutboundConfigurationSet.configurationSetName,
        eventDestination: {
          enabled: true,
          matchingEventTypes: [
            "BOUNCE",
            "COMPLAINT",
            "DELIVERY",
            "DELIVERY_DELAY",
            "REJECT",
            "SEND",
          ],
          snsDestination: {
            topicArn: mailOutboundFeedbackTopic.arn,
          },
        },
        eventDestinationName: "outbound-feedback",
      },
      { dependsOn: [mailOutboundFeedbackTopicPolicy] }
    );
  mailOutboundFeedbackTopic.subscribe("MailOutboundFeedbackProcessor", {
    environment: {
      DATABASE_URL: context.databaseUrl,
      QUIETER_DEPLOYMENT_ENV: deploymentEnvironment,
      SES_FEEDBACK_TOPIC_ARN: mailOutboundFeedbackTopic.arn,
      ...context.sentryEnvironment,
    },
    handler: "packages/aws/src/outbound-feedback.handler",
    link: [mailOutboundFeedbackDeadLetterQueue],
    retries: 2,
    timeout: "60 seconds",
    transform: {
      eventInvokeConfig(args) {
        args.destinationConfig = {
          onFailure: {
            destination: mailOutboundFeedbackDeadLetterQueue.arn,
          },
        };
      },
    },
  });

  void mailOutboundFeedbackEventDestination;
  void mailOutboundFeedbackDeadLetterAlarm;

  mailReceiptTopic.subscribe("MailReceiptProcessor", {
    environment: {
      DATABASE_URL: context.databaseUrl,
      POLAR_ACCESS_TOKEN: context.polarAccessToken,
      POLAR_ORGANIZATION_ID: context.polarOrganizationId,
      POLAR_SANDBOX: context.polarSandbox,
      QUIETER_DEPLOYMENT_ENV: deploymentEnvironment,
      QUIETER_GMAIL_AI_AUTOMATION_ENABLED: context.mailAutomationAiEnabled,
      ...context.r2Environment,
      ...context.sentryEnvironment,
    },
    handler: "packages/aws/src/receipt.handler",
    link: [mailBucket],
    timeout: "30 seconds",
  });

  const mailIngressToken = requireSecretResource(
    secretResources,
    "MAIL_INGEST_TOKEN"
  );
  const mailIngress = new sst.aws.Function("MailIngress", {
    environment: {
      DATABASE_URL: context.databaseUrl,
      QUIETER_DEPLOYMENT_ENV: deploymentEnvironment,
      QUIETER_GMAIL_AI_AUTOMATION_ENABLED: context.mailAutomationAiEnabled,
      ...context.r2Environment,
      ...context.sentryEnvironment,
    },
    handler: "packages/aws/src/inbound.handler",
    link: [mailBucket, mailIngressToken],
    timeout: "30 seconds",
    url: true,
  });
  const webAwsPermissions = new sst.Linkable("WebAwsPermissions", {
    include: [
      {
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"],
        type: "aws.permission",
      },
    ],
    properties: {},
  });

  return {
    mailBucket,
    mailIngress,
    mailIngressToken,
    mailOutboundConfigurationSet,
    mailOutboundFeedbackDeadLetterQueue,
    mailOutboundFeedbackTopic,
    mailReceiptRole,
    mailReceiptTopic,
    webAwsPermissions,
  };
};
