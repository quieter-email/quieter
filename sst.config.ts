// oxlint-disable-next-line typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

const requiredEnv = (...names: string[]) => {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }

  throw new Error(`${names[0]} environment variable is missing.`);
};

const optionalEnv = (...names: string[]) => {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
};

export default $config({
  app(input) {
    return {
      home: "aws",
      name: "quietr",
      protect: input.stage === "production",
      removal: input.stage === "production" ? "retain" : "remove",
    };
  },
  async run() {
    const mailBucket = new sst.aws.Bucket("MailBucket");
    const mailReceiptTopic = new sst.aws.SnsTopic("MailReceiptTopic");
    const mailIngestToken = new sst.Secret("MailIngestToken", "dev-mail-ingest-token");
    const mailSendToken = new sst.Secret("MailSendToken", "dev-mail-send-token");
    const mailReceiptRuleSetName = "quietr-mail";

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
      environment: {
        DATABASE_URL: requiredEnv("DATABASE_URL"),
      },
      handler: "packages/aws/src/receipt.handler",
      link: [mailBucket],
      timeout: "30 seconds",
    });

    const mailIngress = new sst.aws.Function("MailIngress", {
      environment: {
        DATABASE_URL: requiredEnv("DATABASE_URL"),
        MAIL_INGEST_TOKEN: mailIngestToken.value,
        MAIL_S3_BUCKET: mailBucket.name,
        MAIL_S3_PREFIX:
          optionalEnv("MAIL_S3_PREFIX", "EMAIL_S3_PREFIX", "MANAGED_MAIL_S3_PREFIX") ||
          "mail/inbound",
      },
      handler: "packages/aws/src/inbound.handler",
      link: [mailBucket],
      timeout: "30 seconds",
      url: true,
    });

    const mailOutbound = new sst.aws.Function("MailOutbound", {
      environment: {
        DATABASE_URL: requiredEnv("DATABASE_URL"),
        MAIL_SEND_TOKEN: mailSendToken.value,
      },
      handler: "packages/aws/src/outbound.handler",
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
