// oxlint-disable-next-line typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    if (!/^local-[a-z0-9-]+$/u.test(input.stage)) {
      throw new Error("Local SST requires a personal local-<name> stage.");
    }
    return {
      home: "aws",
      name: "quieter",
      removal: "remove",
      types: { ignore: [".", "apps", "packages"] },
    };
  },
  async run() {
    if (!$dev) {
      throw new Error("This configuration is only for sst dev.");
    }
    const { assertLocalEnvFile, parseEnvFile } =
      await import("@quieter/env/local-doctor");
    const { sstSecretNames } = await import("@quieter/env/sst-secrets");
    assertLocalEnvFile(".env.local");
    const values = parseEnvFile(".env.local");
    const names = Object.entries(sstSecretNames)
      .filter(([key]) => values.has(key))
      .map(([, name]) => name);
    const links = [...names, "LocalWorkerToken"].map(
      (name) => new sst.Secret(name)
    );
    const runtime = new sst.x.DevCommand("LocalRuntime", {
      dev: { command: "vp run dev:linked", title: "Local web and workers" },
      link: links,
    });
    void runtime;
    return { stage: $app.stage, webUrl: "http://localhost:3000" };
  },
});
