"use client";

import { TooltipGroup } from "@quieter/ui";
import { useNavigate } from "@tanstack/react-router";
import { authClient } from "~/lib/auth";
import { settingsRouteApi } from "~/lib/route-apis";
import { OrganizationDetailView } from "./organization-detail-view";
import { OrganizationsListView } from "./organizations-list-view";

export const OrganizationSettingsPanel = () => {
  const navigate = useNavigate({
    from: "/settings",
  });
  const { organizationId, organizationView } = settingsRouteApi.useSearch();
  const sessionState = authClient.useSession();
  const organizationsState = authClient.useListOrganizations();
  const organizations = organizationsState.data ?? [];
  const userId = sessionState.data?.user.id ?? "";
  const loadError = organizationsState.error ?? sessionState.error;
  const selectedOrganization = organizations.find(
    (organization) => organization.id === organizationId,
  );

  const navigateToOrganizationsList = () => {
    void navigate({
      search: (previous) => ({
        ...previous,
        organizationId: "",
        organizationView: "overview",
      }),
      to: ".",
    });
  };

  const navigateToOrganization = (nextOrganizationId: string) => {
    void navigate({
      search: (previous) => ({
        ...previous,
        tab: "organization",
        organizationId: nextOrganizationId,
        organizationView: "overview",
      }),
      to: ".",
    });
  };

  const navigateToMembers = () => {
    void navigate({
      search: (previous) => ({
        ...previous,
        organizationView: "members",
      }),
      to: ".",
    });
  };

  const navigateToDomains = () => {
    void navigate({
      search: (previous) => ({
        ...previous,
        organizationView: "domains",
      }),
      to: ".",
    });
  };

  const navigateToApiKeys = () => {
    void navigate({
      search: (previous) => ({
        ...previous,
        organizationView: "api-keys",
      }),
      to: ".",
    });
  };

  const navigateToOrganizationOverview = () => {
    void navigate({
      search: (previous) => ({
        ...previous,
        organizationView: "overview",
      }),
      to: ".",
    });
  };

  return (
    <TooltipGroup>
      <div className="space-y-6">
        {organizationsState.isPending || sessionState.isPending ? (
          <p className="text-sm text-muted-foreground">Loading teams…</p>
        ) : loadError ? (
          <p className="text-sm text-destructive">{loadError.message ?? "Could not load teams."}</p>
        ) : selectedOrganization ? (
          <OrganizationDetailView
            key={selectedOrganization.id}
            onOpenApiKeys={navigateToApiKeys}
            onBackToList={navigateToOrganizationsList}
            onBackToOrganization={navigateToOrganizationOverview}
            onOpenDomains={navigateToDomains}
            onOpenMembers={navigateToMembers}
            organization={selectedOrganization}
            userId={userId}
            view={organizationView}
          />
        ) : (
          <OrganizationsListView
            onSelectOrganization={navigateToOrganization}
            organizations={organizations}
          />
        )}
      </div>
    </TooltipGroup>
  );
};
