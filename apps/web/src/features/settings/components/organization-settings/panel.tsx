"use client";

import { TooltipGroup } from "@quieter/ui/tooltip";
import { useNavigate } from "@tanstack/react-router";
import { authClient } from "~/lib/auth";
import { settingsRouteApi } from "~/lib/route-apis";
import { SettingsBackButton } from "../settings-layout";
import { OrganizationDetailView } from "./organization-detail-view";
import { OrganizationsListView } from "./organizations-list-view";

export const OrganizationSettingsPanel = () => {
  const navigate = useNavigate({
    from: "/settings",
  });
  const { domainId, organizationId, organizationView } = settingsRouteApi.useSearch();
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
        domainId: "",
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
        domainId: "",
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

  const navigateToDivisions = () => {
    void navigate({
      search: (previous) => ({
        ...previous,
        organizationView: "divisions",
      }),
      to: ".",
    });
  };

  const navigateToDomains = () => {
    void navigate({
      search: (previous) => ({
        ...previous,
        domainId: "",
        organizationView: "domains",
      }),
      to: ".",
    });
  };

  const navigateToDomain = (nextDomainId: string) => {
    void navigate({
      search: (previous) => ({
        ...previous,
        domainId: nextDomainId,
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

  const navigateToBilling = () => {
    void navigate({
      search: (previous) => ({
        ...previous,
        organizationView: "billing",
      }),
      to: ".",
    });
  };

  const navigateToDanger = () => {
    void navigate({
      search: (previous) => ({
        ...previous,
        organizationView: "danger",
      }),
      to: ".",
    });
  };

  const navigateToOrganizationOverview = () => {
    void navigate({
      search: (previous) => ({
        ...previous,
        domainId: "",
        organizationView: "overview",
      }),
      to: ".",
    });
  };

  return (
    <TooltipGroup>
      <div className="space-y-6">
        {organizationsState.isPending || sessionState.isPending ? (
          <>
            {organizationId ? (
              <SettingsBackButton onClick={navigateToOrganizationsList}>Teams</SettingsBackButton>
            ) : null}
            <p className="text-sm text-muted-foreground">Loading teams…</p>
          </>
        ) : loadError ? (
          <>
            {organizationId ? (
              <SettingsBackButton onClick={navigateToOrganizationsList}>Teams</SettingsBackButton>
            ) : null}
            <p className="text-sm text-destructive">
              {loadError.message ?? "Could not load teams."}
            </p>
          </>
        ) : selectedOrganization ? (
          <OrganizationDetailView
            key={selectedOrganization.id}
            domainId={domainId}
            onOpenApiKeys={navigateToApiKeys}
            onBackToList={navigateToOrganizationsList}
            onBackToOrganization={navigateToOrganizationOverview}
            onOpenBilling={navigateToBilling}
            onOpenDanger={navigateToDanger}
            onOpenDivisions={navigateToDivisions}
            onOpenDomains={navigateToDomains}
            onOpenDomain={navigateToDomain}
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
