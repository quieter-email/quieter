"use client";

import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { isDemoModeAvailable } from "#/features/settings/domain/demo-mode-setting";
import {
  settingsDestinationSearch,
  settingsTeamSection,
  TEAM_SETTINGS_NAV,
} from "#/features/settings/domain/settings-destination";
import type { SettingsDestination } from "#/features/settings/domain/settings-destination";
import { authClient } from "#/lib/auth";
import { settingsRouteApi } from "#/lib/route-apis";

import {
  fullOrganizationQueryOptions,
  hasOrganizationPermission,
  normalizeOrganizationRole,
} from "./organization-settings/domain";
import { useSettingsTeam } from "./use-settings-team";

const PERSONAL_ITEMS = [
  { tab: "account", title: "Account" },
  { tab: "appearance", title: "Preferences" },
  { tab: "ai", title: "AI & personalization" },
  { tab: "connectors", title: "Connected apps" },
] as const;

export const SettingsSidebar = () => {
  const navigate = useNavigate({ from: "/settings" });
  const { tab, from, organizationView, organizationId } =
    settingsRouteApi.useSearch();
  const { organizations, organizationsState, team, teamId } = useSettingsTeam();
  const session = authClient.useSession().data;
  const { data: details } = useQuery({
    ...fullOrganizationQueryOptions(teamId),
    enabled: team !== undefined,
  });
  const member = details?.members.find(
    (item) => item.userId === session?.user.id
  );
  const canManage = hasOrganizationPermission(
    member ? normalizeOrganizationRole(member.role) : null,
    { organization: ["update"] }
  );
  const [expanded, setExpanded] = useState(false);
  const open = (destination: SettingsDestination) => {
    setExpanded(false);
    void navigate({
      search: (previous) => ({
        ...previous,
        ...settingsDestinationSearch(destination, teamId),
      }),
      to: ".",
    });
  };
  const navigationButton = (
    title: string,
    destination: SettingsDestination,
    selected: boolean
  ) => (
    <Button
      key={title}
      aria-current={selected ? "page" : undefined}
      className={cn("w-full justify-start font-normal", {
        "bg-accent text-fg": selected,
      })}
      onClick={() => {
        open(destination);
      }}
      variant="ghost"
      size="sm"
    >
      {title}
    </Button>
  );
  return (
    <aside className="max-h-[70dvh] shrink-0 overflow-y-auto border-b border-border bg-bg-raised p-3 md:h-full md:max-h-none md:w-60 md:overflow-y-auto md:border-r md:border-b-0 md:p-4">
      <div className="flex items-center justify-between md:mb-6">
        <Button
          onClick={() => {
            void navigate({ to: from });
          }}
          variant="ghost"
          size="sm"
        >
          ← Back to mail
        </Button>
        <Button
          aria-expanded={expanded}
          aria-controls="settings-navigation"
          className="md:hidden"
          onClick={() => {
            setExpanded(!expanded);
          }}
          variant="outline"
          size="sm"
        >
          Settings menu
        </Button>
      </div>
      <nav
        id="settings-navigation"
        aria-label="Settings"
        className={cn("space-y-5 md:block", { hidden: !expanded })}
      >
        <div className="space-y-1">
          <p className="px-3 py-1 text-caption text-muted-fg">Personal</p>
          {PERSONAL_ITEMS.map((item) =>
            navigationButton(
              item.title,
              { tab: item.tab },
              item.tab === tab ||
                (item.tab === "appearance" &&
                  ["overview", "reading", "privacy", "shortcuts"].includes(tab))
            )
          )}
          {isDemoModeAvailable() &&
            navigationButton(
              "Development",
              { tab: "development" },
              tab === "development"
            )}
        </div>
        <div className="space-y-1">
          <p className="px-3 py-1 text-caption text-muted-fg">Team settings</p>
          <Select
            items={organizations.map((item) => ({
              label: item.name,
              value: item.id,
            }))}
            value={team?.id ?? null}
            onValueChange={(value) => {
              if (!value) {
                return;
              }
              setExpanded(false);
              void navigate({
                search: (previous) => ({
                  ...previous,
                  domainId: "",
                  mailboxId: "",
                  mailboxView: "list",
                  organizationId: value,
                  section:
                    previous.mailboxId !== "" || previous.domainId !== ""
                      ? ""
                      : previous.section,
                }),
                to: ".",
              });
            }}
          >
            <SelectTrigger aria-label="Team settings" className="mb-2 w-full">
              <SelectValue
                placeholder={
                  organizationsState.isPending
                    ? "Loading teams"
                    : "Choose a team"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {organizations.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {organizationsState.error && (
            <p role="alert" className="px-3 text-caption text-destructive">
              Could not load teams.
            </p>
          )}
          {team && (
            <>
              {TEAM_SETTINGS_NAV.flatMap((item) =>
                item.view === "delivery" && !canManage ? (
                  []
                ) : (
                  <div key={item.view}>
                    {navigationButton(
                      item.title,
                      { organizationView: item.view, tab: "organization" },
                      tab === "organization" &&
                        organizationId !== "" &&
                        settingsTeamSection(organizationView) === item.view
                    )}
                    {item.view === "members" &&
                      navigationButton(
                        "Mailboxes",
                        { tab: "mailboxes" },
                        tab === "mailboxes"
                      )}
                  </div>
                )
              )}
            </>
          )}
          {navigationButton(
            "Manage teams",
            { organizationId: "", tab: "organization" },
            tab === "organization" && organizationId === ""
          )}
        </div>
      </nav>
    </aside>
  );
};
