import { describe, expect, it } from "vite-plus/test";

import { createRuntimeHealthEnv } from "./runtime-health.ts";

const resources = {
  App: { stage: "release-proof-health" },
  ReleaseProofToken: { value: "a".repeat(64) },
};
const bindings = {
  QUIETER_RUNTIME_HEALTH: JSON.stringify({
    publicHosts: ["mail.example.com"],
    stage: "release-proof-health",
  }),
  QUIETER_VERSION: { id: "00000000-0000-4000-8000-000000000269" },
  SST_RESOURCES_JSON: JSON.stringify(resources),
};

describe("runtime release health configuration", () => {
  it("remains dormant until the intended runtime enables its health bindings", () => {
    expect(createRuntimeHealthEnv({})).toBeNull();
  });

  it("reads both supported SST link formats and the provider version identity", () => {
    const expected = {
      publicHosts: ["mail.example.com"],
      token: "a".repeat(64),
      versionId: bindings.QUIETER_VERSION.id,
    };
    expect(createRuntimeHealthEnv(bindings)).toStrictEqual(expected);
    expect(
      createRuntimeHealthEnv({
        ...bindings,
        SST_RESOURCES_JSON: undefined,
        SST_RESOURCE_App: JSON.stringify(resources.App),
        SST_RESOURCE_ReleaseProofToken: JSON.stringify(
          resources.ReleaseProofToken
        ),
      })
    ).toStrictEqual(expected);
  });

  it.each([
    { ...bindings, QUIETER_VERSION: undefined },
    { ...bindings, QUIETER_VERSION: { id: "build-label" } },
    {
      ...bindings,
      SST_RESOURCES_JSON: JSON.stringify({
        ...resources,
        App: { stage: "production" },
      }),
    },
    { ...bindings, SST_RESOURCES_JSON: "{}" },
    {
      ...bindings,
      QUIETER_RUNTIME_HEALTH: JSON.stringify({
        publicHosts: ["*.workers.dev"],
        stage: "release-proof-health",
      }),
    },
    {
      ...bindings,
      QUIETER_RUNTIME_HEALTH: JSON.stringify({
        publicHosts: ["mail.example.com"],
        stage: "production",
      }),
    },
  ])(
    "rejects missing identity, stage mismatches, and unrestricted host configuration",
    (value) => {
      expect(() => createRuntimeHealthEnv(value)).toThrow(
        "Invalid release health bindings."
      );
    }
  );
});
