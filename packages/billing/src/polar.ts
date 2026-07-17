import { ORPCError } from "@orpc/server";
import { Polar } from "@polar-sh/sdk";
import { serverEnv } from "@quieter/env/server";
import { getPolarApiOrganizationId, getPolarServer, resolvePolarServer } from "./polar-config";

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

export const getPolarSandboxMode = () => getPolarServer() === "sandbox";

export const getPolarClient = () => {
  if (polarClient) return polarClient;

  polarClient = new Polar({
    accessToken: getPolarAccessToken(),
    server: getPolarServer(),
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
  await getPolarClient().events.ingest({
    events,
  });
};

export { getPolarApiOrganizationId, getPolarServer, resolvePolarServer };
