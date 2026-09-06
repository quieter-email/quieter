import { describe, expect, test } from "vite-plus/test";

import { createSourceMapUploadEnv } from "./deployment";

const destination = {
  QUIETER_RELEASE_STAGE: "release-proof-maps",
  SENTRY_ORG: "fixture",
  SENTRY_PROJECT: "fixture-staging",
  SENTRY_URL: "https://de.sentry.io",
};

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
