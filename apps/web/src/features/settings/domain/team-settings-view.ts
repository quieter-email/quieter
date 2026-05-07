export const TEAM_SETTINGS_VIEWS = ["overview", "members"] as const;
export type TeamSettingsView = (typeof TEAM_SETTINGS_VIEWS)[number];
