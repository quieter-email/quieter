export const getOrganizationApiKeyOrganizationId = async (
  request: Request
): Promise<string | null> => {
  const { verifyOrganizationApiKey, OrganizationApiKeyRateLimitError } =
    await import("@quieter/auth/api-key-verification");
  let identity: Awaited<ReturnType<typeof verifyOrganizationApiKey>>;
  try {
    identity = await verifyOrganizationApiKey(request);
  } catch (error) {
    if (error instanceof OrganizationApiKeyRateLimitError) {
      return null;
    }
    throw error;
  }
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
