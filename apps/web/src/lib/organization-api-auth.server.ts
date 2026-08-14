export const getOrganizationApiKeyOrganizationId = async (
  request: Request
): Promise<string | null> => {
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

  const [{ organizationApiKeyApi }, { ORGANIZATION_API_KEY_CONFIG_ID }] =
    await Promise.all([
      import("@quieter/auth"),
      import("@quieter/orpc/organization-mail"),
    ]);
  const verifiedApiKey = await organizationApiKeyApi.verifyApiKey({
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

  return verifiedApiKey.key.referenceId;
};
