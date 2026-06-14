import type { Polar } from "@polar-sh/sdk";
import { ORPCError } from "@orpc/server";
import { serverEnv } from "@quieter/env/server";

let polarClient: Polar | null = null;

const getPolarAccessToken = () => {
  const accessToken = serverEnv.POLAR_ACCESS_TOKEN;

  if (!accessToken) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Polar billing is not configured.",
    });
  }

  return accessToken;
};

export const getPolarSandboxMode = () => {
  if (serverEnv.POLAR_SANDBOX !== undefined) {
    return serverEnv.POLAR_SANDBOX;
  }

  return serverEnv.NODE_ENV !== "production";
};

export const getPolarClient = async () => {
  if (polarClient) return polarClient;

  const { Polar } = await import("@polar-sh/sdk");

  polarClient = new Polar({
    accessToken: getPolarAccessToken(),
    server: getPolarSandboxMode() ? "sandbox" : "production",
  });

  return polarClient;
};

export const ingestPolarEvents = async (
  events: Array<{
    externalCustomerId: string;
    externalId?: string;
    metadata?: Record<string, boolean | number | string>;
    name: string;
    organizationId?: string;
  }>,
) => {
  const response = await fetch(
    `${getPolarSandboxMode() ? "https://sandbox-api.polar.sh" : "https://api.polar.sh"}/v1/events/ingest`,
    {
      body: JSON.stringify({
        events: events.map((event) => ({
          external_customer_id: event.externalCustomerId,
          external_id: event.externalId,
          metadata: event.metadata,
          name: event.name,
          organization_id: event.organizationId,
        })),
      }),
      headers: {
        authorization: `Bearer ${getPolarAccessToken()}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Polar event ingestion failed with status ${response.status}${body ? `: ${body.slice(0, 500)}` : "."}`,
    );
  }
};

const POLAR_ORGANIZATION_ACCESS_TOKEN_PREFIX = "polar_oat_";

const usesPolarOrganizationAccessToken = () =>
  serverEnv.POLAR_ACCESS_TOKEN?.startsWith(POLAR_ORGANIZATION_ACCESS_TOKEN_PREFIX) ?? false;

/** Polar API request scope; omit when the access token is already org-scoped. */
export const getPolarApiOrganizationId = (): string | undefined => {
  if (usesPolarOrganizationAccessToken()) {
    return undefined;
  }

  return serverEnv.POLAR_ORGANIZATION_ID;
};
