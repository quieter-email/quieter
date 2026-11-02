import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import {
  getOrganizationApiKeyAccess,
  getOrganizationApiKeyOrganizationId,
} from "./organization-api-auth.server";

const mocks = vi.hoisted(() => ({
  hasBillingAccess: vi.fn<() => Promise<boolean>>(),
  verifyApiKey: vi.fn<
    () => Promise<{
      valid: boolean;
      error?: { code: string; details?: { tryAgainIn: number } };
      key: { configId: string; referenceId: string } | null;
    }>
  >(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Partial mock avoids initializing server dependencies.
vi.mock("@quieter/auth", () => ({
  auth: { api: { verifyApiKey: mocks.verifyApiKey } },
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Only the API authorization contract is needed here.
vi.mock("@quieter/orpc/organization-mail", () => ({
  ORGANIZATION_API_KEY_CONFIG_ID: "organization",
  organizationHasBillingFeature: mocks.hasBillingAccess,
}));

describe("organization API access", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.verifyApiKey.mockResolvedValue({
      key: { configId: "organization", referenceId: "team-a" },
      valid: true,
    });
  });

  test("rejects an existing key after subscription access ends", async () => {
    mocks.hasBillingAccess.mockResolvedValue(false);
    await expect(
      getOrganizationApiKeyOrganizationId(
        new Request("https://quieter.email/api/send", {
          headers: { authorization: "Bearer test-key" },
        })
      )
    ).resolves.toBeNull();
    expect(mocks.hasBillingAccess).toHaveBeenCalledWith({
      feature: "organizationApiKeys",
      organizationId: "team-a",
    });
  });

  test("restores the same key after the subscription recovers", async () => {
    mocks.hasBillingAccess
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const request = new Request(
      "https://quieter.email/api/messages/message-a",
      { headers: { authorization: "Bearer test-key" } }
    );
    await expect(
      getOrganizationApiKeyOrganizationId(request)
    ).resolves.toBeNull();
    await expect(getOrganizationApiKeyOrganizationId(request)).resolves.toBe(
      "team-a"
    );
  });

  test("does not look up billing for an invalid key", async () => {
    mocks.verifyApiKey.mockResolvedValue({ key: null, valid: false });
    await expect(
      getOrganizationApiKeyOrganizationId(
        new Request("https://quieter.email/api/send", {
          headers: { authorization: "Bearer test-key" },
        })
      )
    ).resolves.toBeNull();
    expect(mocks.hasBillingAccess).not.toHaveBeenCalled();
  });

  test("returns a retryable response when a valid key is rate limited", async () => {
    mocks.verifyApiKey.mockResolvedValue({
      error: { code: "RATE_LIMITED", details: { tryAgainIn: 15_000 } },
      key: null,
      valid: false,
    });
    const request = new Request("https://quieter.email/api/control", {
      headers: { authorization: "Bearer test-key" },
    });
    await expect(getOrganizationApiKeyAccess(request)).resolves.toMatchObject({
      status: 429,
    });
    await expect(
      getOrganizationApiKeyOrganizationId(request)
    ).resolves.toMatchObject({ status: 429 });
    expect(mocks.hasBillingAccess).not.toHaveBeenCalled();
  });

  test("does not grant access when billing is unavailable", async () => {
    mocks.hasBillingAccess.mockRejectedValue(new Error("Billing unavailable"));
    await expect(
      getOrganizationApiKeyOrganizationId(
        new Request("https://quieter.email/api/send", {
          headers: { authorization: "Bearer test-key" },
        })
      )
    ).rejects.toThrow("Billing unavailable");
  });
});
