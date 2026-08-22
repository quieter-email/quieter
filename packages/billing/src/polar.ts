import { ORPCError } from "@orpc/server";
import type { Polar } from "@polar-sh/sdk";
import { serverEnv } from "@quieter/env/server";

import { getPolarServer } from "./polar-config.ts";

export {
  getPolarApiOrganizationId,
  getPolarServer,
  resolvePolarServer,
} from "./polar-config.ts";

let polarClient: Polar | null = null;

const getPolarAccessToken = () => {
  const accessToken = serverEnv.POLAR_ACCESS_TOKEN;

  if (accessToken === undefined || accessToken === "") {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Polar billing is not configured.",
    });
  }

  return accessToken;
};

export const getPolarSandboxMode = () => getPolarServer() === "sandbox";

/**
 * The Polar SDK is a thousand generated modules. Loading it on demand keeps it out of
 * the startup path of every handler that imports this package, most of which only
 * report usage or read a plan.
 */
export const getPolarClient = async () => {
  if (polarClient !== null) {
    return polarClient;
  }

  const accessToken = getPolarAccessToken();
  const { Polar } = await import("@polar-sh/sdk");
  polarClient ??= new Polar({
    accessToken,
    server: getPolarServer(),
  });

  return polarClient;
};

export const ingestPolarEvents = async (
  events: {
    externalCustomerId: string;
    externalId?: string;
    metadata?: Record<string, boolean | number | string>;
    name: string;
    organizationId?: string;
  }[]
) => {
  const polar = await getPolarClient();
  await polar.events.ingest({
    events,
  });
};
