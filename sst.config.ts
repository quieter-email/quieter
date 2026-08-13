// oxlint-disable-next-line typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      home: "aws",
      name: "quieter",
      providers: { cloudflare: "6.15.0" },
      protect: input.stage === "production",
      removal: input.stage === "production" ? "retain" : "remove",
      state: {
        compress: true,
        retention: 30,
      },
    };
  },
  async run() {
    const { createInfrastructure } = await import("./infra/app");
    const { createSecretInfrastructure } = await import("./infra/secrets");
    const secrets = createSecretInfrastructure();
    return createInfrastructure(secrets);
  },
});
