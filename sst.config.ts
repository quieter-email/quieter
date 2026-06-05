// oxlint-disable-next-line typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      home: "aws",
      name: "quieter",
      protect: input.stage === "production",
      removal: input.stage === "production" ? "retain" : "remove",
    };
  },
  async run() {
    const callerIdentity = await aws.getCallerIdentity({});
    const region = await aws.getRegion({});
    const mailObjectKeyPrefix = "mail/inbound/";
    const mailReceiptRuleSetName = "quieter-mail";
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
    const mailReceiptTopic = new sst.aws.SnsTopic("MailReceiptTopic");
    const mailIngestToken = new sst.Secret("MailIngestToken");
    const mailSendToken = new sst.Secret("MailSendToken");

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

    new aws.iam.RolePolicy("MailReceiptRolePolicy", {
      policy: $jsonStringify({
        Statement: [
          {
            Action: ["s3:PutObject"],
            Effect: "Allow",
            Resource: [mailBucket.arn.apply((arn) => `${arn}/${mailObjectKeyPrefix}*`)],
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
    });

    mailReceiptTopic.subscribe("MailReceiptProcessor", {
      environment: {
        DATABASE_URL: process.env.DATABASE_URL ?? "",
        POLAR_ACCESS_TOKEN: process.env.POLAR_ACCESS_TOKEN ?? "",
        POLAR_ORGANIZATION_ID: process.env.POLAR_ORGANIZATION_ID ?? "",
        POLAR_SANDBOX: process.env.POLAR_SANDBOX ?? "",
      },
      handler: "packages/aws/src/receipt.handler",
      link: [mailBucket],
      timeout: "30 seconds",
    });

    const mailIngress = new sst.aws.Function("MailIngress", {
      handler: "packages/aws/src/inbound.handler",
      link: [mailBucket, mailIngestToken],
      timeout: "30 seconds",
      url: true,
    });

    const mailOutbound = new sst.aws.Function("MailOutbound", {
      handler: "packages/aws/src/outbound.handler",
      link: [mailSendToken],
      permissions: [
        {
          actions: ["ses:SendEmail", "ses:SendRawEmail"],
          resources: ["*"],
        },
      ],
      timeout: "30 seconds",
      url: true,
    });

    return {
      mailBucket: mailBucket.name,
      mailIngressUrl: mailIngress.url,
      mailOutboundUrl: mailOutbound.url,
      mailIngestTokenSecretName: mailIngestToken.name,
      mailReceiptRoleArn: mailReceiptRole.arn,
      mailReceiptRuleSetName,
      mailReceiptTopicArn: mailReceiptTopic.arn,
      mailSendTokenSecretName: mailSendToken.name,
      stage: $app.stage,
    };
  },
});
