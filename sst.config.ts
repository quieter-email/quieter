// oxlint-disable-next-line typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    const isPreview = input.stage.startsWith("pr-");

    return {
      home: isPreview ? "cloudflare" : "aws",
      name: "quieter",
      providers: { cloudflare: "6.15.0" },
      protect: input.stage === "production",
      removal: input.stage === "production" ? "retain" : "remove",
    };
  },
  async run() {
    const { githubSstSecrets } = await import("@quieter/env/github");
    const { createSstEnv } = await import("@quieter/env/sst");
    const production = $app.stage === "production";
    const preview = $app.stage.startsWith("pr-");
    const previewSecretNames = new Set<keyof typeof githubSstSecrets>([
      "APP_SITE_PASSWORD",
      "BETTER_AUTH_SECRET",
      "DATABASE_URL",
      "SENTRY_DSN",
    ]);
    const secretResources = Object.fromEntries(
      Object.entries(githubSstSecrets)
        .filter(
          ([environmentName]) =>
            !preview || previewSecretNames.has(environmentName as keyof typeof githubSstSecrets),
        )
        .map(([environmentName, secretName]) => [environmentName, new sst.Secret(secretName)]),
    ) as Record<keyof typeof githubSstSecrets, sst.Secret>;
    const webSecretBindings = Object.entries(secretResources)
      .filter(
        ([environmentName]) =>
          environmentName !== "GMAIL_PUBSUB_PROCESS_TOKEN" &&
          environmentName !== "MAIL_INGEST_TOKEN",
      )
      .map(
        ([environmentName, secret]) =>
          new sst.Linkable(environmentName, {
            include: [
              sst.cloudflare.binding({
                properties: { text: secret.value },
                type: "secretTextBindings",
              }),
            ],
            properties: {},
          }),
      );
    const parsePostgresOrigin = (connectionString: string) => {
      const url = new URL(connectionString);
      const database = decodeURIComponent(
        url.pathname.replace(/^\//, "").split("/")[0]?.split("?")[0] || "",
      );

      if (!url.hostname || !url.username || !database) {
        throw new Error("DATABASE_URL must include host, user, and database for Hyperdrive");
      }

      return {
        database,
        host: url.hostname,
        password: decodeURIComponent(url.password),
        port: url.port ? Number(url.port) : 5432,
        user: decodeURIComponent(url.username),
      };
    };
    const appDatabaseOrigin = secretResources.DATABASE_URL.value.apply(parsePostgresOrigin);
    const appDatabase = new sst.cloudflare.Hyperdrive("AppDatabaseV2", {
      caching: false,
      origin: {
        database: appDatabaseOrigin.database,
        host: appDatabaseOrigin.host,
        password: appDatabaseOrigin.password,
        port: appDatabaseOrigin.port,
        scheme: "postgres",
        user: appDatabaseOrigin.user,
      },
    });
    const appOrigin = production
      ? "https://quieter.email"
      : preview
        ? `https://${$app.stage}.preview.quieter.email`
        : process.env.BETTER_AUTH_URL || "http://localhost:3000";
    const createWeb = (
      runtimeEnvironment: Record<string, $util.Input<string>> = {},
      links: $util.Input<any>[] = [],
    ) =>
      new sst.cloudflare.TanStackStart("Web", {
        domain: production
          ? { name: "quieter.email", redirects: ["www.quieter.email"] }
          : preview
            ? `${$app.stage}.preview.quieter.email`
            : undefined,
        environment: {
          AWS_DEFAULT_REGION: process.env.AWS_REGION || "eu-central-1",
          AWS_REGION: process.env.AWS_REGION || "eu-central-1",
          BETTER_AUTH_APP_NAME: process.env.BETTER_AUTH_APP_NAME || "quieter",
          BETTER_AUTH_TRUSTED_ORIGINS: process.env.BETTER_AUTH_TRUSTED_ORIGINS || "",
          BETTER_AUTH_URL: appOrigin,
          NODE_ENV: "production",
          QUIETER_AUTH_MAIL_MODE: process.env.QUIETER_AUTH_MAIL_MODE || "api",
          QUIETER_AUTH_MAIL_SENDER: process.env.QUIETER_AUTH_MAIL_SENDER || "auth@quieter.email",
          QUIETER_DEPLOYMENT_ENV: production ? "production" : preview ? "preview" : "local",
          QUIETER_GMAIL_AI_AUTOMATION_ENABLED: String(production),
          QUIETER_MAIL_API_URL: `${appOrigin}/api/v1/send`,
          QUIETER_PREVIEW_PERSONAS_ENABLED:
            process.env.QUIETER_PREVIEW_PERSONAS_ENABLED || (preview ? "true" : "false"),
          SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT || $app.stage,
          VITE_LOGO_DEV_PUBLISHABLE_KEY: process.env.VITE_LOGO_DEV_PUBLISHABLE_KEY || "",
          VITE_PUBLIC_POSTHOG_HOST:
            process.env.VITE_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
          VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: process.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN || "",
          VITE_QUIETER_PREVIEW_PERSONAS_ENABLED:
            process.env.VITE_QUIETER_PREVIEW_PERSONAS_ENABLED || (preview ? "true" : "false"),
          VITE_SENTRY_DSN: process.env.VITE_SENTRY_DSN || "",
          ...runtimeEnvironment,
        },
        link: [...webSecretBindings, appDatabase, ...links],
        path: "apps/web",
        transform: {
          server: {
            compatibility: {
              date: "2026-07-11",
              flags: ["nodejs_compat"],
            },
          },
        },
      });

    if (preview) {
      const web = createWeb();

      return { stage: $app.stage, webUrl: web.url };
    }
    const env = createSstEnv({ production });
    const polarSandbox = env.POLAR_SANDBOX === undefined ? "" : String(env.POLAR_SANDBOX);
    const mailAutomationAiEnabled = String(
      env.QUIETER_GMAIL_AI_AUTOMATION_ENABLED ?? $app.stage === "production",
    );
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
    const mailIngestToken = secretResources.MAIL_INGEST_TOKEN;

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
        QUIETER_GMAIL_AI_AUTOMATION_ENABLED: mailAutomationAiEnabled,
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

    const chatGenerationStartToken = secretResources.CHAT_GENERATION_START_TOKEN;
    const gmailLiveSyncTokenSecret = secretResources.GMAIL_LIVE_SYNC_TOKEN_SECRET;
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
      const gmailPubSubProcessToken = secretResources.GMAIL_PUBSUB_PROCESS_TOKEN;
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
            QUIETER_GMAIL_AI_AUTOMATION_ENABLED: mailAutomationAiEnabled,
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
                dns: sst.cloudflare.dns(),
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
          QUIETER_GMAIL_AI_AUTOMATION_ENABLED: mailAutomationAiEnabled,
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
        QUIETER_GMAIL_AI_AUTOMATION_ENABLED: mailAutomationAiEnabled,
        ...r2Environment,
      },
      handler: "packages/aws/src/inbound.handler",
      link: [mailBucket, mailIngestToken],
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
    const web = createWeb(
      {
        CHAT_GENERATION_START_URL: chatGenerationEnqueue.url,
        GMAIL_LIVE_SYNC_URL: gmailLiveSyncUrl,
        MAILBOX_ACTION_QUEUE_URL: mailboxActionQueue.url,
        MAIL_BUCKET: mailBucket.name,
        MAIL_RECEIPT_ROLE_ARN: mailReceiptRole.arn,
        MAIL_RECEIPT_RULE_SET_NAME: mailReceiptRuleSetName,
        MAIL_RECEIPT_TOPIC_ARN: mailReceiptTopic.arn,
        POLAR_METER_CREDIT_USAGE_ID: env.POLAR_METER_CREDIT_USAGE_ID ?? "",
        POLAR_ORGANIZATION_ID: env.POLAR_ORGANIZATION_ID ?? "",
        POLAR_PRODUCT_MANAGED_ID: env.POLAR_PRODUCT_MANAGED_ID ?? "",
        POLAR_PRODUCT_PRO_ID: env.POLAR_PRODUCT_PRO_ID ?? "",
        POLAR_SANDBOX: env.POLAR_SANDBOX === undefined ? "" : String(env.POLAR_SANDBOX),
        QUIETER_GMAIL_AI_AUTOMATION_ENABLED: String(
          env.QUIETER_GMAIL_AI_AUTOMATION_ENABLED ?? production,
        ),
        R2_ACCOUNT_ID: env.R2_ACCOUNT_ID ?? "",
        R2_BUCKET: env.R2_BUCKET ?? "",
        R2_ENDPOINT: env.R2_ENDPOINT ?? "",
      },
      [mailBucket, webAwsPermissions],
    );

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
      webUrl: web.url,
    };
  },
});
