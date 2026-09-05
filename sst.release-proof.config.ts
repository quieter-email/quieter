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
    const { createReleaseProofEnv } = await import("@quieter/env/deployment");
    const { createRuntimeVersion } = await import("./infra/runtime-version");
    const { COMPATIBILITY_DATE } =
      await import("@quieter/cloudflare/compatibility-date");
    const phase = createReleaseProofEnv().QUIETER_RELEASE_PROOF_PHASE;
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
    const journal = new sst.aws.Bucket("ReleaseJournal", { versioning: true });
    let captured: cloudflare.WorkersScriptArgs | undefined;
    const worker = new sst.cloudflare.Worker("Probe", {
      compatibility: { date: COMPATIBILITY_DATE, flags: ["nodejs_compat"] },
      environment: { PROBE_GENERATION: phase },
      handler: "packages/deployment/src/release-probe.ts",
      link: [binding, archive],
      transform: {
        worker(args, options) {
          captured = args;
          if (phase === "candidate") {
            options.ignoreChanges = ["*"];
          }
        },
      },
      url: true,
    });
    if (captured === undefined || captured.contentFile === undefined) {
      throw new Error("SST did not produce a native Worker module.");
    }
    const candidate =
      phase === "candidate"
        ? createRuntimeVersion("Candidate", worker, captured)
        : undefined;
    return {
      archive: archive.name,
      candidateVersion: candidate?.id,
      journal: journal.name,
      phase,
      scriptName: worker.nodes.worker.scriptName,
      url: worker.url,
    };
  },
});
