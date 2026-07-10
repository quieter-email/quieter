import { ORPCError } from "@orpc/server";
import { Polar } from "@polar-sh/sdk";
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

export const resolvePolarServer = (input: {
  nodeEnvironment: "development" | "production" | "test";
  polarSandbox?: boolean;
  vercelEnvironment?: string;
}) => {
  if (input.vercelEnvironment === "production") return "production";
  if (input.polarSandbox !== undefined) return input.polarSandbox ? "sandbox" : "production";
  return input.nodeEnvironment === "production" ? "production" : "sandbox";
};

export const getPolarServer = () =>
  resolvePolarServer({
    nodeEnvironment: serverEnv.NODE_ENV,
    polarSandbox: serverEnv.POLAR_SANDBOX,
    vercelEnvironment: serverEnv.VERCEL_ENV,
  });

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
