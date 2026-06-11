import type { Polar } from "@polar-sh/sdk";
import { ORPCError } from "@orpc/server";

let polarClient: Polar | null = null;

export const getPolarSandboxMode = () => {
  const configured = process.env.POLAR_SANDBOX?.trim().toLowerCase();

  if (configured) {
    return ["1", "true", "yes", "on"].includes(configured);
  }

  return process.env.NODE_ENV !== "production";
};

export const getPolarClient = async () => {
  if (polarClient) return polarClient;

  const accessToken = process.env.POLAR_ACCESS_TOKEN?.trim();

  if (!accessToken) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Polar billing is not configured.",
    });
  }

  const { Polar } = await import("@polar-sh/sdk");

  polarClient = new Polar({
    accessToken,
    server: getPolarSandboxMode() ? "sandbox" : "production",
  });

  return polarClient;
};

const POLAR_ORGANIZATION_ACCESS_TOKEN_PREFIX = "polar_oat_";

const usesPolarOrganizationAccessToken = () =>
  process.env.POLAR_ACCESS_TOKEN?.trim().startsWith(POLAR_ORGANIZATION_ACCESS_TOKEN_PREFIX) ??
  false;

/** Polar API request scope; omit when the access token is already org-scoped. */
export const getPolarApiOrganizationId = (): string | undefined => {
  if (usesPolarOrganizationAccessToken()) {
    return undefined;
  }

  return process.env.POLAR_ORGANIZATION_ID?.trim() || undefined;
};
