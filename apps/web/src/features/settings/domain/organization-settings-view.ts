export const ORGANIZATION_SETTINGS_VIEWS = [
  "overview",
  "members",
  "divisions",
  "domains",
  "api-keys",
  "billing",
  "danger",
] as const;
export type OrganizationSettingsView = (typeof ORGANIZATION_SETTINGS_VIEWS)[number];
