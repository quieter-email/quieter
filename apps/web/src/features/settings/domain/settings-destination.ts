import type { OrganizationSettingsView } from "./organization-settings-view";
import type { SettingsTab } from "./settings-tab";

export type SettingsDestination = {
  tab: SettingsTab;
  organizationView?: OrganizationSettingsView;
  mailboxId?: string;
  organizationId?: string;
  section?: string;
};

export const TEAM_SETTINGS_NAV = [
  { title: "General", view: "overview" },
  { title: "Members & access", view: "members" },
  { title: "Domains", view: "domains" },
  { title: "Delivery", view: "delivery" },
  { title: "Billing & usage", view: "billing" },
  { title: "API keys", view: "api-keys" },
] as const satisfies readonly {
  title: string;
  view: OrganizationSettingsView;
}[];

export const settingsTeamSection = (view: OrganizationSettingsView) => {
  if (view === "divisions") {
    return "members";
  }
  if (view === "suppressions") {
    return "delivery";
  }
  if (view === "danger") {
    return "overview";
  }
  return view;
};

export const settingsDestinationSearch = (
  destination: SettingsDestination,
  teamId: string
) => ({
  domainId: "",
  mailboxId: destination.mailboxId ?? "",
  mailboxView: "list" as const,
  organizationId: destination.organizationId ?? teamId,
  organizationView: destination.organizationView ?? "overview",
  section: destination.section ?? "",
  tab: destination.tab,
});
