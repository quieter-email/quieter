import type { GrowthScope } from "@quieter/orpc/growth-access";
import { z } from "zod";

export type OrganizationApiKeyAccess = {
  organizationId: string;
  apiKeyId: string;
  scopes: GrowthScope[];
};

export const getOrganizationApiKeyAccess = async (
  request: Request
): Promise<OrganizationApiKeyAccess | Response | null> => {
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

  if (verifiedApiKey.error?.code === "RATE_LIMITED") {
    const details = z
      .object({
        details: z.object({ tryAgainIn: z.number().nonnegative() }),
      })
      .safeParse(verifiedApiKey.error).data?.details;
    return Response.json(
      { error: "This key has reached its request limit. Try again later." },
      {
        headers: {
          "cache-control": "no-store",
          "retry-after": String(
            Math.max(1, Math.ceil((details?.tryAgainIn ?? 60_000) / 1000))
          ),
        },
        status: 429,
      }
    );
  }

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
): Promise<string | Response | null> => {
  const access = await getOrganizationApiKeyAccess(request);
  if (access instanceof Response) {
    return access;
  }
  return access?.organizationId ?? null;
};
