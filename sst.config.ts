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

    const databaseUrl = process.env.DATABASE_URL;
    const polarAccessToken = process.env.POLAR_ACCESS_TOKEN;

    if (!databaseUrl) throw new Error("DATABASE_URL is required for MailReceiptProcessor.");
    if (!polarAccessToken)
      throw new Error("POLAR_ACCESS_TOKEN is required for MailReceiptProcessor.");

    mailReceiptTopic.subscribe("MailReceiptProcessor", {
      environment: {
        DATABASE_URL: databaseUrl,
        POLAR_ACCESS_TOKEN: polarAccessToken,
        POLAR_ORGANIZATION_ID: process.env.POLAR_ORGANIZATION_ID ?? "",
        POLAR_SANDBOX: process.env.POLAR_SANDBOX ?? "",
      },
      handler: "packages/aws/src/receipt.handler",
      link: [mailBucket],
      timeout: "30 seconds",
    });

    const openRouterApiKey = process.env.OPENROUTER_API_KEY;
    const googleGmailClientId = process.env.GOOGLE_GMAIL_CLIENT_ID;
    const googleGmailClientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET;
    const gmailTokenEncryptionKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;

    if (!openRouterApiKey)
      throw new Error("OPENROUTER_API_KEY is required for ChatGenerationWorkflow.");
    if (!googleGmailClientId) {
      throw new Error("GOOGLE_GMAIL_CLIENT_ID is required for ChatGenerationWorkflow.");
    }
    if (!googleGmailClientSecret) {
      throw new Error("GOOGLE_GMAIL_CLIENT_SECRET is required for ChatGenerationWorkflow.");
    }
    if (!gmailTokenEncryptionKey) {
      throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY is required for ChatGenerationWorkflow.");
    }

    const chatGenerationStartToken = new sst.Secret("ChatGenerationStartToken");
    const chatGenerationQueue = new sst.aws.Queue("ChatGenerationQueue");
    const chatGenerationWorkflow = new sst.aws.Workflow("ChatGenerationWorkflow", {
      environment: {
        DATABASE_URL: databaseUrl,
        GMAIL_TOKEN_ENCRYPTION_KEY: gmailTokenEncryptionKey,
        GOOGLE_GMAIL_CLIENT_ID: googleGmailClientId,
        GOOGLE_GMAIL_CLIENT_SECRET: googleGmailClientSecret,
        OPENROUTER_API_KEY: openRouterApiKey,
        POLAR_ACCESS_TOKEN: polarAccessToken,
        POLAR_ORGANIZATION_ID: process.env.POLAR_ORGANIZATION_ID ?? "",
        POLAR_SANDBOX: process.env.POLAR_SANDBOX ?? "",
      },
      handler: "packages/aws/src/chat-generation-workflow.handler",
      timeout: {
        execution: "2 hours",
        invocation: "15 minutes",
      },
    });
    chatGenerationQueue.subscribe("packages/aws/src/chat-generation-starter.handler", {
      batch: {
        partialResponses: true,
      },
      link: [chatGenerationWorkflow],
      timeout: "30 seconds",
    });
    const chatGenerationEnqueue = new sst.aws.Function("ChatGenerationEnqueue", {
      handler: "packages/aws/src/chat-generation-enqueue.handler",
      link: [chatGenerationQueue, chatGenerationStartToken],
      timeout: "30 seconds",
      url: true,
    });

    const mailIngress = new sst.aws.Function("MailIngress", {
      environment: {
        DATABASE_URL: databaseUrl,
      },
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
      chatGenerationEnqueueUrl: chatGenerationEnqueue.url,
      chatGenerationStartTokenSecretName: chatGenerationStartToken.name,
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
