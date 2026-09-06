import { verifyOrganizationApiKey } from "@quieter/auth/api-key-verification";

export const getOrganizationApiKeyOrganizationId = async (
  request: Request
): Promise<string | null> => {
  const identity = await verifyOrganizationApiKey(request);
  if (identity === null) {
    return null;
  }
  const { organizationHasBillingFeature } =
    await import("@quieter/orpc/organization-mail");
  const hasAccess = await organizationHasBillingFeature({
    feature: "organizationApiKeys",
    organizationId: identity.organizationId,
  });
  if (!hasAccess) {
    return null;
  }

  return identity.organizationId;
};
