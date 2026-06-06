export const ORGANIZATION_SETTINGS_VIEWS = ["overview", "members", "domains", "api-keys"] as const;
export type OrganizationSettingsView = (typeof ORGANIZATION_SETTINGS_VIEWS)[number];
