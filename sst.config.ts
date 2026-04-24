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
    const mailBucket = new sst.aws.Bucket("MailBucket");
    const mailReceiptTopic = new sst.aws.SnsTopic("MailReceiptTopic");
    const mailIngestToken = new sst.Secret("MailIngestToken", "dev-mail-ingest-token");
    const mailSendToken = new sst.Secret("MailSendToken", "dev-mail-send-token");
    const mailReceiptRuleSetName = "quieter-mail";

    const mailReceiptRole = new aws.iam.Role("MailReceiptRole", {
      assumeRolePolicy: $jsonStringify({
        Statement: [
          {
            Action: "sts:AssumeRole",
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
            Resource: [mailBucket.arn.apply((arn) => `${arn}/*`)],
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
