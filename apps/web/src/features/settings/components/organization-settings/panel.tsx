"use client";

import { TooltipGroup } from "@quieter/ui/tooltip";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { authClient } from "#/lib/auth";
import { settingsRouteApi } from "#/lib/route-apis";

import { SettingsBackButton, SettingsLoadingState } from "../settings-layout";
import { OrganizationDetailView } from "./organization-detail-view";
import { OrganizationsListView } from "./organizations-list-view";

export const OrganizationSettingsPanel = () => {
  const navigate = useNavigate({
    from: "/settings",
  });
  const { domainId, organizationId, organizationView } =
    settingsRouteApi.useSearch();
  const sessionState = authClient.useSession();
  const organizationsState = authClient.useListOrganizations();
  const organizations = organizationsState.data ?? [];
  const userId = sessionState.data?.user.id ?? "";
  const loadError = organizationsState.error ?? sessionState.error;
  const selectedOrganization = organizations.find(
    (organization) => organization.id === organizationId
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
        organizationId: nextOrganizationId,
        organizationView: "overview",
        tab: "organization",
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

  const navigateToSuppressions = () => {
    void navigate({
      search: (previous) => ({
        ...previous,
        organizationView: "suppressions",
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

  let panelContent: ReactNode = null;
  if (organizationId === undefined || organizationId === "") {
    panelContent = (
      <OrganizationsListView
        error={
          loadError?.message ??
          (loadError ? "Could not load teams." : undefined)
        }
        isPending={organizationsState.isPending || sessionState.isPending}
        onSelectOrganization={navigateToOrganization}
        organizations={organizations}
      />
    );
  } else if (organizationsState.isPending || sessionState.isPending) {
    panelContent = (
      <>
        <SettingsBackButton onClick={navigateToOrganizationsList}>
          Teams
        </SettingsBackButton>
        <SettingsLoadingState className="min-h-48" label="Loading teams" />
      </>
    );
  } else if (loadError) {
    panelContent = (
      <>
        <SettingsBackButton onClick={navigateToOrganizationsList}>
          Teams
        </SettingsBackButton>
        <p className="text-body text-destructive">
          {loadError.message ?? "Could not load teams."}
        </p>
      </>
    );
  } else if (selectedOrganization) {
    panelContent = (
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
        onOpenSuppressions={navigateToSuppressions}
        organization={selectedOrganization}
        userId={userId}
        view={organizationView}
      />
    );
  }

  return (
    <TooltipGroup>
      <div className="space-y-6">{panelContent}</div>
    </TooltipGroup>
  );
};
