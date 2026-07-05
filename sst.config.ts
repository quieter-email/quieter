// oxlint-disable-next-line typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    const hasCloudflareCredentials =
      !!process.env.CLOUDFLARE_API_TOKEN ||
      (!!process.env.CLOUDFLARE_API_KEY && !!process.env.CLOUDFLARE_EMAIL);
    const providers =
      input.stage === "production"
        ? { cloudflare: "6.15.0", vercel: "4.6.0" }
        : hasCloudflareCredentials
          ? { cloudflare: "6.15.0" }
          : undefined;

    return {
      home: "aws",
      name: "quieter",
      providers,
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
    new aws.s3.BucketLifecycleConfigurationV2("MailBucketLifecycle", {
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
    });
    const mailReceiptTopic = new sst.aws.SnsTopic("MailReceiptTopic");
    const mailIngestToken = new sst.Secret("MailIngestToken");

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
    const r2Environment = {
      R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID ?? "",
      R2_ACCOUNT_ID: env.R2_ACCOUNT_ID ?? "",
      R2_BUCKET: env.R2_BUCKET ?? "",
      R2_ENDPOINT: env.R2_ENDPOINT ?? "",
      R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY ?? "",
    };

    mailReceiptTopic.subscribe("MailReceiptProcessor", {
      environment: {
        DATABASE_URL: databaseUrl,
        POLAR_ACCESS_TOKEN: polarAccessToken,
        POLAR_ORGANIZATION_ID: env.POLAR_ORGANIZATION_ID ?? "",
        POLAR_SANDBOX: polarSandbox,
        ...r2Environment,
      },
      handler: "packages/aws/src/receipt.handler",
      link: [mailBucket],
      timeout: "30 seconds",
    });

    const openRouterApiKey = env.OPENROUTER_API_KEY;
    const connectorTokenEncryptionKey = env.CONNECTOR_TOKEN_ENCRYPTION_KEY ?? "";
    const googleCalendarClientId = env.GOOGLE_CALENDAR_CLIENT_ID ?? "";
    const googleCalendarClientSecret = env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "";
    const googleGmailClientId = env.GOOGLE_GMAIL_CLIENT_ID;
    const googleGmailClientSecret = env.GOOGLE_GMAIL_CLIENT_SECRET;
    const linearClientId = env.LINEAR_CLIENT_ID ?? "";
    const linearClientSecret = env.LINEAR_CLIENT_SECRET ?? "";
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
        CONNECTOR_TOKEN_ENCRYPTION_KEY: connectorTokenEncryptionKey,
        DATABASE_URL: databaseUrl,
        GMAIL_TOKEN_ENCRYPTION_KEY: gmailTokenEncryptionKey,
        GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT: gmailTokenEncryptionKeyCurrent,
        GOOGLE_CALENDAR_CLIENT_ID: googleCalendarClientId,
        GOOGLE_CALENDAR_CLIENT_SECRET: googleCalendarClientSecret,
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
    const mailboxActionDeadLetterQueue = new sst.aws.Queue("MailboxActionDeadLetterQueue", {
      transform: {
        queue: {
          messageRetentionSeconds: 60 * 60 * 24 * 14,
        },
      },
    });
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
          CONNECTOR_TOKEN_ENCRYPTION_KEY: connectorTokenEncryptionKey,
          DATABASE_URL: databaseUrl,
          GMAIL_TOKEN_ENCRYPTION_KEY: gmailTokenEncryptionKey,
          GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT: gmailTokenEncryptionKeyCurrent,
          GOOGLE_GMAIL_CLIENT_ID: googleGmailClientId,
          GOOGLE_GMAIL_CLIENT_SECRET: googleGmailClientSecret,
          LINEAR_CLIENT_ID: linearClientId,
          LINEAR_CLIENT_SECRET: linearClientSecret,
          OPENROUTER_API_KEY: openRouterApiKey,
          POLAR_ACCESS_TOKEN: polarAccessToken,
          POLAR_ORGANIZATION_ID: env.POLAR_ORGANIZATION_ID ?? "",
          POLAR_SANDBOX: polarSandbox,
        },
        handler: "packages/aws/src/mailbox-action-consumer.handler",
        timeout: "15 minutes",
      },
      {
        batch: {
          partialResponses: true,
          size: 1,
        },
      },
    );

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
      },
      handler: "packages/aws/src/gmail-live-sync-websocket.handler",
      link: [gmailLiveSyncConnections, gmailLiveSyncTokenSecret],
      timeout: "30 seconds",
    });
    gmailLiveSyncApi.route("$connect", gmailLiveSyncHandler.arn);
    gmailLiveSyncApi.route("$disconnect", gmailLiveSyncHandler.arn);
    gmailLiveSyncApi.route("ping", gmailLiveSyncHandler.arn);
    let gmailLiveSyncUrl: $util.Output<string> = gmailLiveSyncApi.url;

    let gmailPubSubIngressUrl: $util.Output<string> | null = null;
    let gmailPubSubProcessUrl: $util.Output<string> | null = null;
    let gmailPubSubProcessTokenSecretName: $util.Output<string> | null = null;
    if (gmailPubSubEnabled) {
      const gmailPubSubProcessToken = new sst.Secret("GmailPubSubProcessToken");
      gmailPubSubProcessTokenSecretName = gmailPubSubProcessToken.name;
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
          DATABASE_URL: databaseUrl,
          ...gmailPubSubEnvironment,
          GMAIL_PUBSUB_QUEUE_URL: gmailPubSubQueue.url,
        },
        handler: "packages/aws/src/gmail-pubsub-ingress.handler",
        link: [gmailPubSubQueue, gmailLiveSyncApi, gmailLiveSyncConnections],
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

      const gmailPubSubProcess = new sst.aws.Function("GmailPubSubProcess", {
        environment: {
          DATABASE_URL: databaseUrl,
          GMAIL_PUBSUB_PROCESS_TOKEN: gmailPubSubProcessToken.value,
          GMAIL_TOKEN_ENCRYPTION_KEY: gmailTokenEncryptionKey,
          GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT: gmailTokenEncryptionKeyCurrent,
          GOOGLE_GMAIL_CLIENT_ID: googleGmailClientId,
          GOOGLE_GMAIL_CLIENT_SECRET: googleGmailClientSecret,
          OPENROUTER_API_KEY: openRouterApiKey,
          POLAR_ACCESS_TOKEN: polarAccessToken,
          POLAR_ORGANIZATION_ID: env.POLAR_ORGANIZATION_ID ?? "",
          POLAR_SANDBOX: polarSandbox,
        },
        handler: "packages/aws/src/gmail-pubsub-process.handler",
        link: [gmailLiveSyncApi, gmailLiveSyncConnections, gmailPubSubProcessToken],
        timeout: "15 minutes",
        url: true,
      });
      gmailPubSubProcessUrl = gmailPubSubProcess.url;

      const gmailPubSubCloudflareDeadLetterQueue = new sst.cloudflare.Queue("GmailPsDlq");
      const gmailPubSubCloudflareQueue = new sst.cloudflare.Queue("GmailPsQueue", {
        dlq: {
          queue: gmailPubSubCloudflareDeadLetterQueue.nodes.queue.queueName,
          retry: 10,
        },
        maxConcurrency: 20,
      });
      const gmailLiveSyncMailbox = new sst.cloudflare.DurableObject("GmailLiveSyncMailbox", {
        className: "GmailLiveSyncMailbox",
      });
      const gmailRealtimeWorker = new sst.cloudflare.Worker("GmailRealtimeWorker", {
        compatibility: {
          date: "2026-06-24",
          flags: ["nodejs_compat"],
        },
        environment: {
          GMAIL_PUBSUB_PROCESS_URL: gmailPubSubProcess.url,
          GMAIL_PUBSUB_PUSH_AUDIENCE: gmailPubSubEnvironment.GMAIL_PUBSUB_PUSH_AUDIENCE,
          GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT:
            gmailPubSubEnvironment.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT,
          GMAIL_PUBSUB_SUBSCRIPTION: gmailPubSubEnvironment.GMAIL_PUBSUB_SUBSCRIPTION,
        },
        handler: "packages/cloudflare/src/worker.ts",
        link: [
          gmailLiveSyncMailbox,
          gmailLiveSyncTokenSecret,
          gmailPubSubCloudflareQueue,
          gmailPubSubProcessToken,
        ],
        migrations: [
          {
            newSqliteClasses: [gmailLiveSyncMailbox.className],
            tag: "v1",
          },
        ],
        url: true,
      });
      gmailPubSubCloudflareQueue.subscribe(
        {
          environment: {
            GMAIL_PUBSUB_PROCESS_URL: gmailPubSubProcess.url,
          },
          handler: "packages/cloudflare/src/worker.ts",
          link: [gmailPubSubProcessToken],
        },
        {
          batch: {
            size: 1,
            window: "0 seconds",
          },
        },
      );
      gmailLiveSyncUrl = gmailRealtimeWorker.url.apply(
        (url) => `${url.replace(/^http/, "ws")}/gmail/live`,
      );
      gmailPubSubIngressUrl = gmailRealtimeWorker.url.apply((url) => `${url}/gmail/pubsub`);
    }

    const mailIngress = new sst.aws.Function("MailIngress", {
      environment: {
        DATABASE_URL: databaseUrl,
        ...r2Environment,
      },
      handler: "packages/aws/src/inbound.handler",
      link: [mailBucket, mailIngestToken],
      timeout: "30 seconds",
      url: true,
    });

    return {
      chatGenerationEnqueueUrl: chatGenerationEnqueue.url,
      chatGenerationStartTokenSecretName: chatGenerationStartToken.name,
      gmailLiveSyncTokenSecretName: gmailLiveSyncTokenSecret.name,
      gmailLiveSyncUrl,
      gmailPubSubIngressUrl,
      gmailPubSubProcessTokenSecretName,
      gmailPubSubProcessUrl,
      gmailPubSubPushAudience: gmailPubSubEnvironment.GMAIL_PUBSUB_PUSH_AUDIENCE || null,
      mailBucket: mailBucket.name,
      mailIngressUrl: mailIngress.url,
      mailIngestTokenSecretName: mailIngestToken.name,
      mailboxActionQueueUrl: mailboxActionQueue.url,
      mailReceiptRoleArn: mailReceiptRole.arn,
      mailReceiptRuleSetName,
      mailReceiptTopicArn: mailReceiptTopic.arn,
      stage: $app.stage,
    };
  },
});
