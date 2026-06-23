import { describe, expect, test } from "bun:test";
import { createBillingCheckoutMetadata, createBillingPortalSession } from "../src";
import { resolvePolarServer } from "../src/polar";

describe("Polar server selection", () => {
  test("forces production for Vercel production deployments", () => {
    expect(
      resolvePolarServer({
        nodeEnvironment: "production",
        polarSandbox: true,
        vercelEnvironment: "production",
      }),
    ).toBe("production");
  });

  test("allows explicit sandbox mode outside Vercel production", () => {
    expect(
      resolvePolarServer({
        nodeEnvironment: "production",
        polarSandbox: true,
        vercelEnvironment: "preview",
      }),
    ).toBe("sandbox");
  });

  test("defaults local development and tests to sandbox", () => {
    expect(resolvePolarServer({ nodeEnvironment: "development" })).toBe("sandbox");
    expect(resolvePolarServer({ nodeEnvironment: "test" })).toBe("sandbox");
  });
});

describe("Polar checkout metadata", () => {
  test("includes organization metadata for checkout", () => {
    const metadata = createBillingCheckoutMetadata({
      organizationId: "organization-1",
      product: "managed",
      userId: "user-1",
    });

    expect(metadata.customerMetadata.quieterOrganizationId).toBe("organization-1");
    expect(metadata.metadata.quieterOrganizationId).toBe("organization-1");
  });
});

describe("Polar customer portal", () => {
  test("opens team customer sessions for the current member", () => {
    expect(
      createBillingPortalSession({
        organizationId: "organization-1",
        returnUrl: "https://quieter.email/settings",
        userId: "user-1",
      }),
    ).toEqual({
      externalCustomerId: "organization:organization-1",
      externalMemberId: "user-1",
      returnUrl: "https://quieter.email/settings",
    });
  });
});
