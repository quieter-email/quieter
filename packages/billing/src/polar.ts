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

export const getPolarOrganizationId = () => process.env.POLAR_ORGANIZATION_ID?.trim() || undefined;
