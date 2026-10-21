"use client";

import { getMailboxDisplayTitle } from "@quieter/app/features/settings/components/mailboxes-settings-shared";
import { organizationMailDomainQueryOptions } from "@quieter/app/features/settings/components/organization-settings/mail-domains";
import { useSettingsTeam } from "@quieter/app/features/settings/components/use-settings-team";
import {
  settingsTeamSection,
  TEAM_SETTINGS_NAV,
} from "@quieter/app/features/settings/domain/settings-destination";
import { SETTINGS_TITLES } from "@quieter/app/features/settings/domain/settings-navigation";
import { mailboxesQueryOptions } from "@quieter/app/lib/mailboxes-query";
import { settingsRouteApi } from "@quieter/app/lib/route-apis";
import { Breadcrumbs } from "@quieter/ui/breadcrumbs";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

type SettingsSearch = ReturnType<typeof settingsRouteApi.useSearch>;
type Crumb = {
  id: string;
  label: string;
  search: Partial<SettingsSearch>;
};

export const SettingsBreadcrumbs = () => {
  const {
    tab,
    mailboxId,
    mailboxView,
    organizationId,
    organizationView,
    domainId,
    section,
  } = settingsRouteApi.useSearch();
  const { team, teamId } = useSettingsTeam();
  const { data: mailboxes } = useQuery(mailboxesQueryOptions());
  const { data: domain } = useQuery({
    ...organizationMailDomainQueryOptions(organizationId, domainId),
    enabled:
      tab === "organization" &&
      organizationView === "domains" &&
      domainId !== "" &&
      organizationId !== "",
  });
  const baseSearch = {
    domainId: "",
    mailboxId: "",
    mailboxView: "list" as const,
    organizationId: "",
    organizationView: "overview" as const,
    section: "",
    tab: "appearance" as const,
  };
  const crumbs: Crumb[] = [{ id: "settings", label: "Settings", search: {} }];

  if (tab === "organization" || tab === "mailboxes") {
    crumbs.push({
      id: "teams",
      label: "Teams",
      search: { tab: "organization" },
    });
    const selectedTeamId = tab === "mailboxes" ? teamId : organizationId;
    if (selectedTeamId !== "") {
      const teamSearch = {
        organizationId: selectedTeamId,
        tab: "organization" as const,
      };
      crumbs.push({
        id: "team",
        label: team?.name ?? "Team",
        search: teamSearch,
      });
      if (tab === "mailboxes") {
        const mailboxSearch = {
          organizationId: selectedTeamId,
          tab: "mailboxes" as const,
        };
        crumbs.push({
          id: "mailboxes",
          label: "Mailboxes",
          search: mailboxSearch,
        });
        if (mailboxView === "add") {
          crumbs.push({
            id: "add-mailbox",
            label: "Add mailbox",
            search: { ...mailboxSearch, mailboxView: "add" },
          });
        } else if (mailboxId !== "") {
          const mailbox = mailboxes?.groups
            .flatMap((group) => group.mailboxes)
            .find((item) => item.id === mailboxId);
          crumbs.push({
            id: "mailbox",
            label: mailbox
              ? getMailboxDisplayTitle(
                  mailbox.displayName,
                  mailbox.emailAddress
                )
              : "Mailbox",
            search: { ...mailboxSearch, mailboxId },
          });
          const mailboxSections = [
            "signature",
            "intelligence",
            "brief",
            "connection",
            "access",
          ];
          if (mailboxSections.includes(section)) {
            crumbs.push({
              id: "mailbox-section",
              label:
                section === "brief"
                  ? "Brief"
                  : section.charAt(0).toUpperCase() + section.slice(1),
              search: { ...mailboxSearch, mailboxId, section },
            });
          }
        }
      } else {
        const view = settingsTeamSection(organizationView);
        const item = TEAM_SETTINGS_NAV.find((entry) => entry.view === view);
        crumbs.push({
          id: "team-section",
          label: item?.title ?? "General",
          search: { ...teamSearch, organizationView: view },
        });
        let subsection = "";
        if (view === "members") {
          subsection =
            organizationView === "divisions"
              ? "Access groups"
              : "Members & invitations";
        } else if (view === "delivery") {
          subsection =
            organizationView === "suppressions"
              ? "Blocked recipients"
              : "Tracking & metrics";
        } else if (view === "billing") {
          subsection = section === "usage" ? "Mail usage" : "Plan & credits";
        } else if (view === "domains" && domainId !== "") {
          subsection = domain?.domain.domain ?? "Domain";
        }
        if (subsection) {
          crumbs.push({
            id: "team-subsection",
            label: subsection,
            search: { ...teamSearch, domainId, organizationView, section },
          });
        }
      }
    }
  } else {
    crumbs.push({
      id: "personal-section",
      label: SETTINGS_TITLES[tab],
      search: { tab },
    });
  }

  return (
    <Breadcrumbs
      items={crumbs.map((crumb, index) => ({
        content:
          index === crumbs.length - 1 ? (
            <span aria-current="page">{crumb.label}</span>
          ) : (
            <Link
              search={(previous) => ({
                ...previous,
                ...baseSearch,
                ...crumb.search,
              })}
              to="/settings"
            >
              {crumb.label}
            </Link>
          ),
        id: crumb.id,
      }))}
    />
  );
};
