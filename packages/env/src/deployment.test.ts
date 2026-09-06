import { describe, expect, test } from "vite-plus/test";

import {
  createDeploymentEnv,
  createReleaseOperationsEnv,
  createReleaseOperationsChildEnv,
  createSourceMapUploadEnv,
} from "./deployment";

const destination = {
  QUIETER_RELEASE_STAGE: "release-proof-maps",
  SENTRY_ORG: "fixture",
  SENTRY_PROJECT: "fixture-staging",
  SENTRY_URL: "https://de.sentry.io",
};

describe("isolated release operation credentials", () => {
  const configuration = {
    AWS_REGION: "eu-central-1",
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    QUIETER_RELEASE_BINDINGS_PARAMETER:
      "arn:aws:ssm:eu-central-1:123456789012:parameter/quieter-release-proof/release-proof-fixture/release/recovery",
    QUIETER_RELEASE_BUCKET: "fixture-journal",
    QUIETER_RELEASE_STAGE: "release-proof-fixture",
  };
  const bindings = {
    purpose: "recovery",
    resources: {
      App: { stage: configuration.QUIETER_RELEASE_STAGE },
      ReleaseCloudflareToken: { value: "scoped-fixture-token" },
      ReleaseProofToken: { value: "p".repeat(32) },
    },
    schemaVersion: 1,
  };

  test("requires a matching parameter stage, purpose, and region", () => {
    expect(createReleaseOperationsEnv("recovery", configuration)).toMatchObject(
      { QUIETER_RELEASE_STAGE: "release-proof-fixture" }
    );
    expect(() => createReleaseOperationsEnv("runtime", configuration)).toThrow(
      "intended stage"
    );
    expect(() =>
      createReleaseOperationsEnv("recovery", {
        ...configuration,
        QUIETER_RELEASE_STAGE: "production",
      })
    ).toThrow("intended stage");
    expect(() =>
      createReleaseOperationsEnv("recovery", {
        ...configuration,
        AWS_REGION: "us-east-1",
      })
    ).toThrow("intended stage");
  });

  test("replaces inherited application links and credentials with the selected operational links", () => {
    const environment = createReleaseOperationsChildEnv(
      JSON.stringify(bindings),
      configuration.QUIETER_RELEASE_STAGE,
      "recovery",
      {
        ...configuration,
        CLOUDFLARE_API_TOKEN: "stale-token",
        QUIETER_RELEASE_PROBE_TOKEN: "stale-probe",
        SST_RESOURCES_JSON: "stale-resources",
        SST_RESOURCE_DatabaseUrl: "private-database",
        SST_RESOURCE_ReleaseProofToken: JSON.stringify({
          value: "stale-probe",
        }),
        sst_resource_ReleaseProofToken: "stale-lowercase-probe",
      }
    );
    expect(createDeploymentEnv(environment)).toMatchObject({
      CLOUDFLARE_API_TOKEN: "scoped-fixture-token",
      QUIETER_RELEASE_PROBE_TOKEN: "p".repeat(32),
    });
    expect(JSON.stringify(environment)).not.toMatch(/stale-|private-database/u);
  });

  test("rejects mismatched bindings and extra application resources", () => {
    expect(() =>
      createReleaseOperationsChildEnv(
        JSON.stringify(bindings),
        "production",
        "recovery",
        {}
      )
    ).toThrow("purpose and stage");
    expect(() =>
      createReleaseOperationsChildEnv(
        JSON.stringify(bindings),
        configuration.QUIETER_RELEASE_STAGE,
        "runtime",
        {}
      )
    ).toThrow("purpose and stage");
    expect(() =>
      createReleaseOperationsChildEnv(
        JSON.stringify({
          ...bindings,
          resources: {
            ...bindings.resources,
            DatabaseUrl: { value: "private-database" },
          },
        }),
        configuration.QUIETER_RELEASE_STAGE,
        "recovery",
        {}
      )
    ).toThrow("purpose and stage");
    expect(() =>
      createReleaseOperationsChildEnv(
        "private-token",
        configuration.QUIETER_RELEASE_STAGE,
        "recovery",
        {}
      )
    ).toThrow("Invalid release operation bindings.");
  });

  test("keeps source-map uploads separate from runtime credentials", () => {
    const value = JSON.stringify({
      purpose: "source-maps",
      resources: {
        App: bindings.resources.App,
        ReleaseSourceMapToken: { value: "map-fixture-token" },
      },
      schemaVersion: 1,
    });
    const environment = createReleaseOperationsChildEnv(
      value,
      configuration.QUIETER_RELEASE_STAGE,
      "source-maps",
      {
        ...configuration,
        ...destination,
        QUIETER_RELEASE_STAGE: configuration.QUIETER_RELEASE_STAGE,
      }
    );
    expect(createSourceMapUploadEnv(environment)).toMatchObject({
      token: "map-fixture-token",
    });
    expect(() => createDeploymentEnv(environment)).toThrow(
      "CLOUDFLARE_API_TOKEN"
    );
    expect(() =>
      createReleaseOperationsChildEnv(
        value,
        configuration.QUIETER_RELEASE_STAGE,
        "runtime",
        {}
      )
    ).toThrow("purpose and stage");
  });
});

describe("source-map upload configuration", () => {
  test("accepts linked credentials only for the requested stage", () => {
    const links = {
      App: { stage: destination.QUIETER_RELEASE_STAGE },
      ReleaseSourceMapToken: { value: "test-secret" },
    };
    expect(
      createSourceMapUploadEnv({
        ...destination,
        SST_RESOURCES_JSON: JSON.stringify(links),
      })
    ).toMatchObject({ stage: "release-proof-maps", token: "test-secret" });
    expect(
      createSourceMapUploadEnv({
        ...destination,
        SST_RESOURCE_App: JSON.stringify(links.App),
        SST_RESOURCE_ReleaseSourceMapToken: JSON.stringify(
          links.ReleaseSourceMapToken
        ),
      })
    ).toMatchObject({ token: "test-secret" });
    expect(() =>
      createSourceMapUploadEnv({
        ...destination,
        QUIETER_RELEASE_STAGE: "production",
        SST_RESOURCES_JSON: JSON.stringify(links),
      })
    ).toThrow("intended stage");
  });

  test("rejects unlinked tokens and malformed secrets without exposing their value", () => {
    expect(() =>
      createSourceMapUploadEnv({
        ...destination,
        SENTRY_AUTH_TOKEN: "test-secret",
      })
    ).toThrow("intended stage");
    expect(() =>
      createSourceMapUploadEnv({
        ...destination,
        SST_RESOURCES_JSON: "test-secret",
      })
    ).toThrow("Invalid linked source-map upload resources.");
    expect(() =>
      createSourceMapUploadEnv({
        ...destination,
        SST_RESOURCE_ReleaseSourceMapToken: JSON.stringify({
          value: "test-secret",
        }),
      })
    ).toThrow("intended stage");
  });
});
