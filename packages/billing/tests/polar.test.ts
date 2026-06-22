import { describe, expect, test } from "bun:test";
import { createBillingCheckoutMetadata } from "../src";
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
  test("omits organization metadata from personal checkout", () => {
    const metadata = createBillingCheckoutMetadata({
      product: "personal",
      scope: "personal",
      userId: "user-1",
    });

    expect(metadata).toEqual({
      customerMetadata: {
        quieterUserId: "user-1",
      },
      metadata: {
        quieterProduct: "personal",
        quieterScope: "personal",
        quieterUserId: "user-1",
      },
    });
  });

  test("includes organization metadata for team checkout", () => {
    const metadata = createBillingCheckoutMetadata({
      organizationId: "organization-1",
      product: "team",
      scope: "team",
      userId: "user-1",
    });

    expect(metadata.customerMetadata.quieterOrganizationId).toBe("organization-1");
    expect(metadata.metadata.quieterOrganizationId).toBe("organization-1");
  });
});
