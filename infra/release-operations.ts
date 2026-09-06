// oxlint-disable-next-line typescript-eslint/triple-slash-reference
/// <reference path="../.sst/platform/config.d.ts" />

export const createReleaseOperationBindings = (input: {
  healthToken: sst.Secret;
  runtimeToken: sst.Secret;
  recoveryToken: sst.Secret;
  sourceMapToken?: sst.Secret;
}) => {
  const runtime = new aws.ssm.Parameter("RuntimeReleaseBindings", {
    name: `/${$app.name}/${$app.stage}/release/runtime`,
    tier: "Standard",
    type: "SecureString",
    value: $jsonStringify({
      purpose: "runtime",
      resources: {
        App: { stage: $app.stage },
        ReleaseCloudflareToken: { value: input.runtimeToken.value },
        ReleaseProofToken: { value: input.healthToken.value },
      },
      schemaVersion: 1,
    }),
  });
  const recovery = new aws.ssm.Parameter("RecoveryReleaseBindings", {
    name: `/${$app.name}/${$app.stage}/release/recovery`,
    tier: "Standard",
    type: "SecureString",
    value: $jsonStringify({
      purpose: "recovery",
      resources: {
        App: { stage: $app.stage },
        ReleaseCloudflareToken: { value: input.recoveryToken.value },
        ReleaseProofToken: { value: input.healthToken.value },
      },
      schemaVersion: 1,
    }),
  });
  const sourceMaps =
    input.sourceMapToken === undefined
      ? undefined
      : new aws.ssm.Parameter("SourceMapReleaseBindings", {
          name: `/${$app.name}/${$app.stage}/release/source-maps`,
          tier: "Standard",
          type: "SecureString",
          value: $jsonStringify({
            purpose: "source-maps",
            resources: {
              App: { stage: $app.stage },
              ReleaseSourceMapToken: { value: input.sourceMapToken.value },
            },
            schemaVersion: 1,
          }),
        });
  return { recovery, runtime, sourceMaps };
};
