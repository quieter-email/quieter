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
