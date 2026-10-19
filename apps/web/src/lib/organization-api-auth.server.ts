import type { GrowthScope } from "@quieter/orpc/growth-access";
import { z } from "zod";

export type OrganizationApiKeyAccess = {
  organizationId: string;
  apiKeyId: string;
  scopes: GrowthScope[];
};

export const getOrganizationApiKeyAccess = async (
  request: Request
): Promise<OrganizationApiKeyAccess | null> => {
  const authorization = request.headers.get("authorization")?.trim();
  if (
    authorization === undefined ||
    authorization === "" ||
    !authorization.startsWith("Bearer ")
  ) {
    return null;
  }

  const apiKey = authorization.slice("Bearer ".length).trim();
  if (apiKey === "") {
    return null;
  }

  const [
    { auth },
    { ORGANIZATION_API_KEY_CONFIG_ID, organizationHasBillingFeature },
  ] = await Promise.all([
    import("@quieter/auth"),
    import("@quieter/orpc/organization-mail"),
  ]);
  const verifiedApiKey = await auth.api.verifyApiKey({
    body: {
      configId: ORGANIZATION_API_KEY_CONFIG_ID,
      key: apiKey,
    },
  });

  if (
    !verifiedApiKey.valid ||
    verifiedApiKey.key === null ||
    verifiedApiKey.key === undefined ||
    verifiedApiKey.key.configId !== ORGANIZATION_API_KEY_CONFIG_ID
  ) {
    return null;
  }

  const hasAccess = await organizationHasBillingFeature({
    feature: "organizationApiKeys",
    organizationId: verifiedApiKey.key.referenceId,
  });
  if (!hasAccess) {
    return null;
  }

  const permissions = z
    .record(z.string(), z.array(z.string()))
    .safeParse(verifiedApiKey.key.permissions).data;
  const scopes: GrowthScope[] = [];
  for (const scope of [
    "audiences:read",
    "audiences:write",
    "campaigns:read",
    "campaigns:write",
    "campaigns:send",
    "templates:read",
    "templates:write",
  ] satisfies GrowthScope[]) {
    const [resource, action] = scope.split(":");
    if (
      resource !== undefined &&
      action !== undefined &&
      permissions?.[resource]?.includes(action) === true
    ) {
      scopes.push(scope);
    }
  }
  return {
    apiKeyId: verifiedApiKey.key.id,
    organizationId: verifiedApiKey.key.referenceId,
    scopes,
  };
};

export const getOrganizationApiKeyOrganizationId = async (
  request: Request
): Promise<string | null> => {
  const access = await getOrganizationApiKeyAccess(request);
  return access?.organizationId ?? null;
};
