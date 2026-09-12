import { Tabs, TabsList, TabsTab } from "@quieter/ui/tabs";
import { useNavigate } from "@tanstack/react-router";

import type { OrganizationSettingsView } from "#/features/settings/domain/organization-settings-view";
import { settingsRouteApi } from "#/lib/route-apis";

export const OrganizationSectionTabs = () => {
  const { organizationView } = settingsRouteApi.useSearch();
  const navigate = useNavigate({ from: "/settings" });
  let items: { label: string; value: OrganizationSettingsView }[] = [];
  if (organizationView === "members" || organizationView === "divisions") {
    items = [
      { label: "Members & invitations", value: "members" },
      { label: "Access groups", value: "divisions" },
    ];
  }
  if (organizationView === "delivery" || organizationView === "suppressions") {
    items = [
      { label: "Tracking & metrics", value: "delivery" },
      { label: "Blocked recipients", value: "suppressions" },
    ];
  }
  if (items.length === 0) {
    return null;
  }
  return (
    <Tabs
      value={organizationView}
      onValueChange={(value) => {
        const item = items.find((entry) => entry.value === value);
        if (item) {
          void navigate({
            search: (previous) => ({
              ...previous,
              organizationView: item.value,
              section: "",
            }),
            to: ".",
          });
        }
      }}
    >
      <TabsList
        aria-label="Team settings sections"
        className="h-auto flex-wrap"
      >
        {items.map((item) => (
          <TabsTab key={item.value} value={item.value}>
            {item.label}
          </TabsTab>
        ))}
      </TabsList>
    </Tabs>
  );
};
