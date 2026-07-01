export const ORGANIZATION_SETTINGS_VIEWS = [
  "overview",
  "members",
  "divisions",
  "domains",
  "api-keys",
] as const;
export type OrganizationSettingsView = (typeof ORGANIZATION_SETTINGS_VIEWS)[number];
