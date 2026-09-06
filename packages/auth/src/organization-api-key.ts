export const ORGANIZATION_API_KEY_CONFIG_ID = "organization";

export const organizationApiKeyOptions = {
  configId: ORGANIZATION_API_KEY_CONFIG_ID,
  defaultPrefix: "quieter_",
  maximumNameLength: 64,
  references: "organization" as const,
  startingCharactersConfig: { charactersLength: 12, shouldStore: true },
};
