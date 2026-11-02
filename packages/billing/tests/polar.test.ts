import { describe, expect, test } from "vite-plus/test";

import {
  createBillingCheckoutMetadata,
  createBillingPortalSession,
} from "../src";
import { resolvePolarServer } from "../src/polar";
import { normalizeSubscriptionStatus } from "../src/subscription-sync";

describe("subscription payment recovery", () => {
  test("distinguishes recoverable payment failure from exhausted retries", () => {
    expect(normalizeSubscriptionStatus("past_due")).toBe("past_due");
    expect(normalizeSubscriptionStatus("unpaid")).toBe("expired");
    expect(normalizeSubscriptionStatus("canceled")).toBe("canceled");
  });
});

describe("Polar server selection", () => {
  test("forces production for production deployments", () => {
    expect(
      resolvePolarServer({
        deploymentEnvironment: "production",
        nodeEnvironment: "development",
        polarSandbox: true,
      })
    ).toBe("production");
  });

  test("allows explicit sandbox mode outside production", () => {
    expect(
      resolvePolarServer({
        deploymentEnvironment: "local",
        nodeEnvironment: "production",
        polarSandbox: true,
      })
    ).toBe("sandbox");
  });

  test("defaults local development and tests to sandbox", () => {
    expect(resolvePolarServer({ nodeEnvironment: "development" })).toBe(
      "sandbox"
    );
    expect(resolvePolarServer({ nodeEnvironment: "test" })).toBe("sandbox");
  });
});

describe("Polar checkout metadata", () => {
  test("includes the payer account in checkout metadata", () => {
    const metadata = createBillingCheckoutMetadata({
      organizationId: "organization-1",
      product: "managed",
      userId: "user-1",
    });

    expect(metadata.customerMetadata).toMatchObject({
      quieterScope: "account",
      quieterUserId: "user-1",
    });
    expect(metadata.metadata).not.toHaveProperty("quieterOrganizationId");
  });
});

describe("Polar customer portal", () => {
  test("opens the payer's account customer session", () => {
    expect(
      createBillingPortalSession({
        returnUrl: "https://quieter.email/settings",
        userId: "user-1",
      })
    ).toStrictEqual({
      externalCustomerId: "user-1",
      returnUrl: "https://quieter.email/settings",
    });
  });
});
