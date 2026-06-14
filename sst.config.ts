// oxlint-disable-next-line typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      home: "aws",
      name: "quieter",
      providers: input.stage === "production" ? { vercel: "4.6.0" } : undefined,
      protect: input.stage === "production",
      removal: input.stage === "production" ? "retain" : "remove",
    };
  },
  async run() {
    const { createSstEnv } = await import("@quieter/env/sst");
    const env = createSstEnv({ production: $app.stage === "production" });
    const polarSandbox = env.POLAR_SANDBOX === undefined ? "" : String(env.POLAR_SANDBOX);
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

    const databaseUrl = env.DATABASE_URL;
    const polarAccessToken = env.POLAR_ACCESS_TOKEN;

    mailReceiptTopic.subscribe("MailReceiptProcessor", {
      environment: {
        DATABASE_URL: databaseUrl,
        POLAR_ACCESS_TOKEN: polarAccessToken,
        POLAR_ORGANIZATION_ID: env.POLAR_ORGANIZATION_ID ?? "",
        POLAR_SANDBOX: polarSandbox,
      },
      handler: "packages/aws/src/receipt.handler",
      link: [mailBucket],
      timeout: "30 seconds",
    });

    const openRouterApiKey = env.OPENROUTER_API_KEY;
    const googleGmailClientId = env.GOOGLE_GMAIL_CLIENT_ID;
    const googleGmailClientSecret = env.GOOGLE_GMAIL_CLIENT_SECRET;
    const gmailTokenEncryptionKey = env.GMAIL_TOKEN_ENCRYPTION_KEY;
    const gmailTokenEncryptionKeyCurrent = env.GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT ?? "";
    const gmailPubSubEnvironment = {
      GMAIL_PUBSUB_PUSH_AUDIENCE: env.GMAIL_PUBSUB_PUSH_AUDIENCE ?? "",
      GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT: env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT ?? "",
      GMAIL_PUBSUB_SUBSCRIPTION: env.GMAIL_PUBSUB_SUBSCRIPTION ?? "",
      GMAIL_PUBSUB_TOPIC: env.GMAIL_PUBSUB_TOPIC ?? "",
    };
    const gmailPubSubEnabled = env.GMAIL_PUBSUB_ENABLED;

    const chatGenerationStartToken = new sst.Secret("ChatGenerationStartToken");
    const gmailLiveSyncTokenSecret = new sst.Secret("GmailLiveSyncTokenSecret");
    const chatGenerationQueue = new sst.aws.Queue("ChatGenerationQueue");
    const chatGenerationWorkflow = new sst.aws.Workflow("ChatGenerationWorkflow", {
      environment: {
        DATABASE_URL: databaseUrl,
        GMAIL_TOKEN_ENCRYPTION_KEY: gmailTokenEncryptionKey,
        GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT: gmailTokenEncryptionKeyCurrent,
        GOOGLE_GMAIL_CLIENT_ID: googleGmailClientId,
        GOOGLE_GMAIL_CLIENT_SECRET: googleGmailClientSecret,
        OPENROUTER_API_KEY: openRouterApiKey,
        POLAR_ACCESS_TOKEN: polarAccessToken,
        POLAR_ORGANIZATION_ID: env.POLAR_ORGANIZATION_ID ?? "",
        POLAR_SANDBOX: polarSandbox,
      },
      handler: "packages/aws/src/chat-generation-workflow.handler",
      timeout: {
        execution: "2 hours",
        invocation: "15 minutes",
      },
    });
    chatGenerationQueue.subscribe(
      {
        handler: "packages/aws/src/chat-generation-starter.handler",
        link: [chatGenerationWorkflow],
        timeout: "30 seconds",
      },
      {
        batch: {
          partialResponses: true,
        },
      },
    );
    const chatGenerationEnqueue = new sst.aws.Function("ChatGenerationEnqueue", {
      handler: "packages/aws/src/chat-generation-enqueue.handler",
      link: [chatGenerationQueue, chatGenerationStartToken],
      timeout: "30 seconds",
      url: true,
    });

    let gmailPubSubIngressUrl: $util.Output<string> | null = null;
    let gmailLiveSyncUrl: $util.Output<string> | null = null;
    if (gmailPubSubEnabled) {
      const gmailLiveSyncConnections = new sst.aws.Dynamo("GmailLiveSyncConnections", {
        fields: {
          connectionId: "string",
          mailboxId: "string",
        },
        globalIndexes: {
          mailboxId: { hashKey: "mailboxId", projection: "keys-only" },
        },
        primaryIndex: { hashKey: "connectionId" },
        ttl: "expiresAt",
      });
      const gmailLiveSyncApi = new sst.aws.ApiGatewayWebSocket("GmailLiveSyncApi");
      const gmailLiveSyncHandler = new sst.aws.Function("GmailLiveSyncWebSocketHandler", {
        environment: {
          DATABASE_URL: databaseUrl,
          POLAR_ACCESS_TOKEN: polarAccessToken,
          POLAR_ORGANIZATION_ID: env.POLAR_ORGANIZATION_ID ?? "",
          POLAR_SANDBOX: polarSandbox,
          QUIETER_UNLIMITED_BILLING_EMAILS: env.QUIETER_UNLIMITED_BILLING_EMAILS ?? "",
        },
        handler: "packages/aws/src/gmail-live-sync-websocket.handler",
        link: [gmailLiveSyncConnections, gmailLiveSyncTokenSecret],
        timeout: "30 seconds",
      });
      gmailLiveSyncApi.route("$connect", gmailLiveSyncHandler.arn);
      gmailLiveSyncApi.route("$disconnect", gmailLiveSyncHandler.arn);
      gmailLiveSyncApi.route("ping", gmailLiveSyncHandler.arn);
      gmailLiveSyncUrl = gmailLiveSyncApi.url;

      const gmailPubSubDeadLetterQueue = new sst.aws.Queue("GmailPubSubDeadLetterQueue", {
        fifo: true,
        transform: {
          queue: {
            messageRetentionSeconds: 60 * 60 * 24 * 14,
          },
        },
      });
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
            DATABASE_URL: databaseUrl,
            GMAIL_PUBSUB_TOPIC: gmailPubSubEnvironment.GMAIL_PUBSUB_TOPIC,
            GMAIL_TOKEN_ENCRYPTION_KEY: gmailTokenEncryptionKey,
            GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT: gmailTokenEncryptionKeyCurrent,
            GOOGLE_GMAIL_CLIENT_ID: googleGmailClientId,
            GOOGLE_GMAIL_CLIENT_SECRET: googleGmailClientSecret,
            OPENROUTER_API_KEY: openRouterApiKey,
            POLAR_ACCESS_TOKEN: polarAccessToken,
            POLAR_ORGANIZATION_ID: env.POLAR_ORGANIZATION_ID ?? "",
            POLAR_SANDBOX: polarSandbox,
            QUIETER_UNLIMITED_BILLING_EMAILS: env.QUIETER_UNLIMITED_BILLING_EMAILS ?? "",
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
        },
      );
      const gmailPubSubIngress = new sst.aws.ApiGatewayV2("GmailPubSubIngress", {
        cors: false,
        domain:
          $app.stage === "production"
            ? {
                dns: sst.vercel.dns({ domain: "quieter.email" }),
                name: "gmail-events.quieter.email",
              }
            : undefined,
      });
      gmailPubSubIngress.route("POST /", {
        environment: {
          ...gmailPubSubEnvironment,
          GMAIL_PUBSUB_QUEUE_URL: gmailPubSubQueue.url,
        },
        handler: "packages/aws/src/gmail-pubsub-ingress.handler",
        link: [gmailPubSubQueue],
        timeout: "30 seconds",
      });
      gmailPubSubIngressUrl = gmailPubSubIngress.url;

      new sst.aws.CronV2("GmailPubSubMaintenance", {
        function: {
          environment: {
            DATABASE_URL: databaseUrl,
            GMAIL_PUBSUB_QUEUE_URL: gmailPubSubQueue.url,
          },
          handler: "packages/aws/src/gmail-pubsub-maintenance.handler",
          link: [gmailPubSubQueue],
          timeout: "5 minutes",
        },
        schedule: "rate(15 minutes)",
      });
    }

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
      gmailLiveSyncTokenSecretName: gmailLiveSyncTokenSecret.name,
      gmailLiveSyncUrl,
      gmailPubSubIngressUrl,
      gmailPubSubPushAudience: gmailPubSubEnvironment.GMAIL_PUBSUB_PUSH_AUDIENCE || null,
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
