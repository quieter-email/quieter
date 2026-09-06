// oxlint-disable-next-line typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    if (!/^release-proof-do-[a-z0-9-]+$/u.test(input.stage)) {
      throw new Error(
        "Durable Object proof requires a separate release-proof-do stage."
      );
    }
    return {
      home: "aws",
      name: "quieter-release-durable",
      providers: { aws: { region: "eu-central-1" }, cloudflare: "6.15.0" },
      removal: "retain",
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
      throw new Error("This fixture has no legacy namespace to adopt.");
    }
    const token = new sst.Secret("ReleaseProofToken");
    const journal = new sst.aws.Bucket("ReleaseJournal", { versioning: true });
    const counter = new sst.cloudflare.DurableObject("ReleaseCounter", {
      className: "ReleaseCounter",
    });
    const tokenBinding = new sst.Linkable("PROBE_TOKEN", {
      include: [
        sst.cloudflare.binding({
          properties: { text: token.value },
          type: "secretTextBindings",
        }),
      ],
      properties: {},
    });
    const versionBinding = new sst.Linkable("PROBE_VERSION", {
      include: [
        sst.cloudflare.binding({
          properties: {},
          type: "versionMetadataBindings",
        }),
      ],
      properties: {},
    });
    let captured: cloudflare.WorkersScriptArgs | undefined;
    const worker = new sst.cloudflare.Worker("DurableProbe", {
      compatibility: { date: COMPATIBILITY_DATE, flags: ["nodejs_compat"] },
      environment: { PROBE_GENERATION: settings.QUIETER_RELEASE_PROOF_PHASE },
      handler: "packages/deployment/src/release-durable-probe.ts",
      link: [counter, tokenBinding, versionBinding],
      migrations: [{ newSqliteClasses: [counter.className], tag: "v1" }],
      transform: {
        worker(args, options) {
          captured = { ...args };
          if (settings.QUIETER_RELEASE_PROOF_PHASE === "candidate") {
            options.ignoreChanges = ["*"];
          }
          args.content = $util.output(args.contentFile).apply(async (file) => {
            if (file === undefined) {
              throw new Error("Missing compiled Durable Object probe.");
            }
            return await readFile(file, "utf-8");
          });
          args.contentFile = undefined;
          args.contentSha256 = undefined;
        },
      },
      url: true,
    });
    if (captured === undefined) {
      throw new Error("Missing Durable Object proof build.");
    }
    // Only this isolated fixture omits the already-applied v1 declaration. Production uploads still reject migrations.
    const candidate =
      settings.QUIETER_RELEASE_PROOF_PHASE === "candidate"
        ? createRuntimeVersion("DurableCandidate", worker, {
            ...captured,
            migrations: undefined,
          })
        : undefined;
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
      journal: journal.name,
      scriptName: worker.nodes.worker.scriptName,
      url: worker.url,
    };
  },
});
