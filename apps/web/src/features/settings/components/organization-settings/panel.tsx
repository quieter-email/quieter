"use client";

import { TooltipGroup } from "@quieter/ui";
import { useNavigate } from "@tanstack/react-router";
import { authClient } from "~/lib/auth";
import { settingsRouteApi } from "~/lib/route-apis";
import { TeamView } from "./team-view";
import { TeamsListView } from "./teams-list-view";

export const OrganizationSettingsPanel = () => {
  const navigate = useNavigate({
    from: "/settings",
  });
  const { teamId, teamView } = settingsRouteApi.useSearch();
  const sessionState = authClient.useSession();
  const organizationsState = authClient.useListOrganizations();
  const organizations = organizationsState.data ?? [];
  const userId = sessionState.data?.user.id ?? "";
  const loadError = organizationsState.error ?? sessionState.error;
  const selectedOrganization = organizations.find((organization) => organization.id === teamId);

  const navigateToTeams = () => {
    void navigate({
      search: (previous) => ({
        ...previous,
        teamId: "",
        teamView: "overview",
      }),
      to: ".",
    });
  };

  const navigateToTeam = (nextTeamId: string) => {
    void navigate({
      search: (previous) => ({
        ...previous,
        tab: "organization",
        teamId: nextTeamId,
        teamView: "overview",
      }),
      to: ".",
    });
  };

  const navigateToMembers = () => {
    void navigate({
      search: (previous) => ({
        ...previous,
        teamView: "members",
      }),
      to: ".",
    });
  };

  const navigateToTeamOverview = () => {
    void navigate({
      search: (previous) => ({
        ...previous,
        teamView: "overview",
      }),
      to: ".",
    });
  };

  return (
    <TooltipGroup>
      <div className="space-y-6">
        {organizationsState.isPending || sessionState.isPending ? (
          <p className="text-sm text-muted-foreground">Loading teams...</p>
        ) : loadError ? (
          <p className="text-sm text-destructive">{loadError.message ?? "Could not load teams."}</p>
        ) : selectedOrganization ? (
          <TeamView
            key={selectedOrganization.id}
            onBackToList={navigateToTeams}
            onBackToTeam={navigateToTeamOverview}
            onOpenMembers={navigateToMembers}
            organization={selectedOrganization}
            userId={userId}
            view={teamView}
          />
        ) : (
          <TeamsListView onSelectTeam={navigateToTeam} organizations={organizations} />
        )}
      </div>
    </TooltipGroup>
  );
};
