import { describe, expect, test, vi } from "vite-plus/test";

import {
  createBillingCheckoutMetadata,
  createBillingPortalSession,
} from "../src";
import { getPolarClient } from "../src/polar";

vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      POLAR_SANDBOX: false,
      QUIETER_DEPLOYMENT_ENV: "local" as const,
    },
  };
});

describe("local billing isolation", () => {
  test("does not address an existing deployment's customer or member", () => {
    expect(
      createBillingPortalSession({
        organizationId: "same-team",
        returnUrl: "http://localhost:3000/settings",
        userId: "same-user",
      })
    ).toMatchObject({
      externalCustomerId: "local:organization:same-team",
      externalMemberId: "local:user:same-user",
    });
    expect(
      createBillingCheckoutMetadata({
        organizationId: "same-team",
        product: "pro",
        userId: "same-user",
      }).metadata
    ).toMatchObject({ quieterEnvironment: "local" });
  });

  test("refuses a live payment client even when local configuration requests one", async () => {
    await expect(getPolarClient()).rejects.toThrow(
      "Local billing requires the Polar sandbox."
    );
  });
});
