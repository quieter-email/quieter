// oxlint-disable-next-line typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    if (!/^release-proof-[a-z0-9-]+$/u.test(input.stage)) {
      throw new Error(
        "Release proof must use an isolated release-proof-<name> stage."
      );
    }
    return {
      home: "aws",
      name: "quieter-release-proof",
      providers: { aws: { region: "eu-central-1" }, cloudflare: "6.15.0" },
      removal: "remove",
      types: { ignore: [".", "apps", "packages"] },
    };
  },
  async run() {
    const { readFile } = await import("node:fs/promises");
    const { createReleaseProofEnv } = await import("@quieter/env/deployment");
    const { createRuntimeVersion } = await import("./infra/runtime-version");
    const { COMPATIBILITY_DATE } =
      await import("@quieter/cloudflare/compatibility-date");
    const proofEnv = createReleaseProofEnv();
    const phase = proofEnv.QUIETER_RELEASE_PROOF_PHASE;
    const token = new sst.Secret("ReleaseProofToken");
    const binding = new sst.Linkable("PROBE_TOKEN", {
      include: [
        sst.cloudflare.binding({
          properties: { text: token.value },
          type: "secretTextBindings",
        }),
      ],
      properties: {},
    });
    const archive = new sst.cloudflare.Bucket("ProbeArchive", {
      transform: { bucket: { name: `${$app.stage}-archive` } },
    });
    const version = new sst.Linkable("PROBE_VERSION", {
      include: [
        sst.cloudflare.binding({
          properties: {},
          type: "versionMetadataBindings",
        }),
      ],
      properties: {},
    });
    const journal = new sst.aws.Bucket("ReleaseJournal", { versioning: true });
    const operations = new sst.x.DevCommand("ReleaseOperations", {
      dev: {
        autostart: false,
        command: "vp run @quieter/deployment#release status",
      },
      link: [token, journal],
    });
    void operations;
    if (proofEnv.QUIETER_RELEASE_SOURCE_MAP_UPLOAD === "true") {
      const sourceMapToken = new sst.Secret("ReleaseSourceMapToken");
      const sourceMapOperations = new sst.x.DevCommand("SourceMapOperations", {
        dev: {
          autostart: false,
          command: "vp run @quieter/deployment#upload:source-maps",
        },
        link: [sourceMapToken, journal],
      });
      void sourceMapOperations;
    }
    let captured: cloudflare.WorkersScriptArgs | undefined;
    const worker = new sst.cloudflare.Worker("Probe", {
      assets: {
        directory: "packages/deployment/fixtures/client",
        runWorkerFirst: true,
      },
      compatibility: { date: COMPATIBILITY_DATE, flags: ["nodejs_compat"] },
      environment: {
        PROBE_GENERATION: phase === "baseline" ? "baseline" : "candidate",
      },
      handler: "packages/deployment/src/release-probe.ts",
      link: [binding, archive, version],
      transform: {
        worker(args, options) {
          captured = { ...args };
          if (phase === "candidate") {
            options.ignoreChanges = ["*"];
          } else if (phase === "adopt") {
            options.ignoreChanges = Object.keys(args).filter(
              (key) =>
                !["content", "contentFile", "contentSha256"].includes(key)
            );
          }
          args.content =
            phase === "adopt"
              ? readFile(".scratch/release-proof-original-module.js", "utf-8")
              : $util.output(args.contentFile).apply(async (file) => {
                  if (file === undefined) {
                    throw new Error("Missing compiled probe module.");
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
      throw new Error("SST did not produce a native Worker module.");
    }
    const candidate =
      phase === "baseline"
        ? undefined
        : createRuntimeVersion("Candidate", worker, captured);
    let web: sst.cloudflare.Worker | undefined;
    if (proofEnv.QUIETER_RELEASE_WEB_PROOF === "true") {
      const databaseUrl = new sst.Secret("ReleaseWebDatabaseUrl");
      const authSecret = new sst.Secret("ReleaseWebAuthSecret");
      const databaseBinding = new sst.Linkable("DATABASE_URL", {
        include: [
          sst.cloudflare.binding({
            properties: {
              text: databaseUrl.value.apply((value) => {
                const url = new URL(value);
                if (
                  !["postgres:", "postgresql:"].includes(url.protocol) ||
                  url.pathname !== "/quieter_dev"
                ) {
                  throw new Error(
                    "The web release proof only permits the existing quieter_dev database."
                  );
                }
                return value;
              }),
            },
            type: "secretTextBindings",
          }),
        ],
        properties: {},
      });
      const authBinding = new sst.Linkable("BETTER_AUTH_SECRET", {
        include: [
          sst.cloudflare.binding({
            properties: { text: authSecret.value },
            type: "secretTextBindings",
          }),
        ],
        properties: {},
      });
      web = new sst.cloudflare.Worker("WebProof", {
        assets: {
          directory: "packages/deployment/fixtures/client",
          runWorkerFirst: true,
        },
        compatibility: { date: COMPATIBILITY_DATE, flags: ["nodejs_compat"] },
        environment: {
          BETTER_AUTH_URL: "https://release-proof.invalid",
          NODE_ENV: "production",
          PROBE_GENERATION: "baseline",
          QUIETER_AUTH_MAIL_MODE: "console",
          QUIETER_DEPLOYMENT_ENV: "local",
          QUIETER_GMAIL_AI_AUTOMATION_ENABLED: "false",
          QUIETER_LOCAL_PROVIDER_MODE: "observe",
          VITE_QUIETER_LOCAL_TELEMETRY: "false",
        },
        handler: "packages/deployment/src/release-probe.ts",
        link: [binding, version, databaseBinding, authBinding],
        transform: {
          worker(args, options) {
            options.ignoreChanges = ["*"];
            args.content = $util
              .output(args.contentFile)
              .apply(async (file) => {
                if (file === undefined) {
                  throw new Error("Missing compiled web proof baseline.");
                }
                return await readFile(file, "utf-8");
              });
            args.contentFile = undefined;
            args.contentSha256 = undefined;
          },
        },
        url: true,
      });
    }
    return {
      archive: archive.name,
      candidateVersion: candidate?.id,
      journal: journal.name,
      phase,
      scriptName: worker.nodes.worker.scriptName,
      url: worker.url,
      webScriptName: web?.nodes.worker.scriptName,
      webUrl: web?.url,
    };
  },
});
