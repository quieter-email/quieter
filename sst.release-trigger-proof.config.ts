// oxlint-disable-next-line typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    if (!/^release-proof-triggers-[a-z0-9-]+$/u.test(input.stage)) {
      throw new Error(
        "Trigger proof requires a separate release-proof-triggers stage."
      );
    }
    return {
      home: "aws",
      name: "quieter-release-triggers",
      providers: { aws: { region: "eu-central-1" }, cloudflare: "6.15.0" },
      removal: "remove",
      types: { ignore: [".", "apps", "packages"] },
    };
  },
  async run() {
    const { readFile } = await import("node:fs/promises");
    const { createReleaseProofEnv } = await import("@quieter/env/deployment");
    const { COMPATIBILITY_DATE } =
      await import("@quieter/cloudflare/compatibility-date");
    const { createRuntimeVersion } = await import("./infra/runtime-version");
    const settings = createReleaseProofEnv();
    if (settings.QUIETER_RELEASE_PROOF_PHASE === "adopt") {
      throw new Error(
        "This new isolated fixture has no legacy state to adopt."
      );
    }
    const token = new sst.Secret("ReleaseProofToken");
    const journal = new sst.aws.Bucket("ReleaseJournal", { versioning: true });
    const records = new sst.cloudflare.Bucket("TriggerRecords", {
      transform: { bucket: { name: `${$app.stage}-records` } },
    });
    const deadLetters = new sst.cloudflare.Queue("TriggerDeadLetters");
    const queue = new sst.cloudflare.Queue("TriggerQueue", {
      transform: { queue: { queueName: `${$app.stage}-queue` } },
    });
    const bindings = [
      new sst.Linkable("PROBE_TOKEN", {
        include: [
          sst.cloudflare.binding({
            properties: { text: token.value },
            type: "secretTextBindings",
          }),
        ],
        properties: {},
      }),
      new sst.Linkable("PROBE_VERSION", {
        include: [
          sst.cloudflare.binding({
            properties: {},
            type: "versionMetadataBindings",
          }),
        ],
        properties: {},
      }),
      new sst.Linkable("PROBE_RECORDS", {
        include: [
          sst.cloudflare.binding({
            properties: { bucketName: records.name },
            type: "r2BucketBindings",
          }),
        ],
        properties: {},
      }),
      new sst.Linkable("PROBE_QUEUE", {
        include: [
          sst.cloudflare.binding({
            properties: { queueName: queue.nodes.queue.queueName },
            type: "queueBindings",
          }),
        ],
        properties: {},
      }),
    ];
    let captured: cloudflare.WorkersScriptArgs | undefined;
    const worker = new sst.cloudflare.Worker("TriggerProbe", {
      compatibility: { date: COMPATIBILITY_DATE, flags: ["nodejs_compat"] },
      environment: { PROBE_GENERATION: settings.QUIETER_RELEASE_PROOF_PHASE },
      handler: "packages/deployment/src/release-trigger-probe.ts",
      link: bindings,
      transform: {
        worker(args, options) {
          captured = { ...args };
          if (settings.QUIETER_RELEASE_PROOF_PHASE === "candidate") {
            options.ignoreChanges = ["*"];
          }
          args.content = $util.output(args.contentFile).apply(async (file) => {
            if (file === undefined) {
              throw new Error("Missing compiled trigger probe.");
            }
            return await readFile(file, "utf-8");
          });
          args.contentFile = undefined;
          args.contentSha256 = undefined;
        },
      },
      url: true,
    });
    if (captured === undefined || captured.contentFile === undefined) {
      throw new Error("Missing trigger probe build.");
    }
    const candidate =
      settings.QUIETER_RELEASE_PROOF_PHASE === "candidate"
        ? createRuntimeVersion("TriggerCandidate", worker, captured)
        : undefined;
    const consumer = new cloudflare.QueueConsumer("TriggerConsumer", {
      accountId: captured.accountId,
      deadLetterQueue: deadLetters.nodes.queue.queueName,
      queueId: queue.nodes.queue.id,
      scriptName: worker.nodes.worker.scriptName,
      settings: {
        batchSize: 1,
        maxConcurrency: 1,
        maxRetries: 3,
        maxWaitTimeMs: 0,
        retryDelay: 5,
      },
      type: "worker",
    });
    const cron = new cloudflare.WorkersCronTrigger("TriggerSchedule", {
      accountId: captured.accountId,
      schedules:
        settings.QUIETER_RELEASE_TRIGGER_SCHEDULE === "true"
          ? [{ cron: "* * * * *" }]
          : [],
      scriptName: worker.nodes.worker.scriptName,
    });
    const operations = new sst.x.DevCommand("ReleaseOperations", {
      dev: {
        autostart: false,
        command: "vp run @quieter/deployment#release status",
      },
      link: [token, journal],
    });
    void operations;
    return {
      candidateVersion: candidate?.id,
      consumerId: consumer.consumerId,
      journal: journal.name,
      queueId: queue.nodes.queue.id,
      schedules: cron.schedules,
      scriptName: worker.nodes.worker.scriptName,
      url: worker.url,
    };
  },
});
