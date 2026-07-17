import { serverEnv } from "@quieter/env/server";

export const resolvePolarServer = (input: {
  deploymentEnvironment?: "local" | "preview" | "production";
  nodeEnvironment: "development" | "production" | "test";
  polarSandbox?: boolean;
}) => {
  if (input.deploymentEnvironment === "production") return "production";
  if (input.polarSandbox !== undefined) return input.polarSandbox ? "sandbox" : "production";
  return input.nodeEnvironment === "production" ? "production" : "sandbox";
};

export const getPolarServer = () =>
  resolvePolarServer({
    deploymentEnvironment: serverEnv.QUIETER_DEPLOYMENT_ENV,
    nodeEnvironment: serverEnv.NODE_ENV,
    polarSandbox: serverEnv.POLAR_SANDBOX,
  });

/** Polar API request scope; omit when the access token is already organization-scoped. */
export const getPolarApiOrganizationId = (): string | undefined =>
  serverEnv.POLAR_ACCESS_TOKEN?.startsWith("polar_oat_")
    ? undefined
    : serverEnv.POLAR_ORGANIZATION_ID;
