"use client";

import {
  ArrowLeft01Icon,
  Cancel01Icon,
  Settings01Icon,
  UserIcon,
  Mail01Icon,
  UserGroupIcon,
  Key01Icon,
  GlobeIcon,
  CreditCardIcon,
  AiChat01Icon,
  Plug01Icon,
  CodeIcon,
  MailSend02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { SidebarNavItem } from "#/features/navigation/components/sidebar-nav-item";
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

const SETTINGS_ICONS: Record<string, typeof Settings01Icon> = {
  "AI & personalization": AiChat01Icon,
  "API keys": Key01Icon,
  Account: UserIcon,
  "Billing & usage": CreditCardIcon,
  "Connected apps": Plug01Icon,
  Delivery: MailSend02Icon,
  Development: CodeIcon,
  Domains: GlobeIcon,
  General: Settings01Icon,
  Mailboxes: Mail01Icon,
  "Manage teams": UserGroupIcon,
  "Members & access": UserGroupIcon,
  Preferences: Settings01Icon,
};

const PERSONAL_ITEMS = [
  { tab: "account", title: "Account" },
  { tab: "appearance", title: "Preferences" },
  { tab: "ai", title: "AI & personalization" },
  { tab: "connectors", title: "Connected apps" },
] as const;

export const SettingsSidebar = ({
  onRequestClose,
  searchInput,
  searchResults,
}: {
  onRequestClose?: () => void;
  searchInput: ReactNode;
  searchResults?: ReactNode;
}) => {
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
  const open = (destination: SettingsDestination) => {
    onRequestClose?.();
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
    <SidebarNavItem
      active={selected}
      key={title}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "h-6 w-full justify-start gap-2 px-2 text-left text-caption font-normal [&_svg]:size-3.5",
        {
          "text-fg": selected,
          "text-muted-fg": !selected,
        }
      )}
      onClick={() => {
        open(destination);
      }}
      variant="ghost"
      size="sm"
    >
      <HugeiconsIcon
        icon={SETTINGS_ICONS[title] ?? Settings01Icon}
        strokeWidth={1.5}
        className="shrink-0 text-fg"
      />
      {title}
    </SidebarNavItem>
  );
  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6">
      <div className="mb-3 flex items-center justify-between px-1">
        <Button
          className="h-7 justify-start gap-2 px-2 text-caption"
          onClick={() => {
            void navigate({ to: from });
          }}
          variant="ghost"
          size="sm"
        >
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            strokeWidth={1.5}
            className="size-4"
          />
          Back to mail
        </Button>
        {onRequestClose && (
          <IconButtonTooltip label="Close settings menu">
            <Button
              aria-label="Close settings menu"
              size="icon-sm"
              variant="ghost"
              onClick={onRequestClose}
            >
              <HugeiconsIcon
                icon={Cancel01Icon}
                strokeWidth={1.5}
                className="size-4"
              />
            </Button>
          </IconButtonTooltip>
        )}
      </div>
      <div className="mb-4 px-1">{searchInput}</div>
      {searchResults !== undefined && searchResults !== null ? (
        <div className="px-1">{searchResults}</div>
      ) : (
        <nav aria-label="Settings" className="space-y-4 p-1">
          <div className="space-y-0">
            <p className="px-2 py-1 text-caption text-muted-fg">Personal</p>
            {PERSONAL_ITEMS.map((item) =>
              navigationButton(
                item.title,
                { tab: item.tab },
                item.tab === tab ||
                  (item.tab === "appearance" &&
                    ["overview", "reading", "privacy", "shortcuts"].includes(
                      tab
                    ))
              )
            )}
            {isDemoModeAvailable() &&
              navigationButton(
                "Development",
                { tab: "development" },
                tab === "development"
              )}
          </div>
          <div className="space-y-0">
            <p className="px-2 py-1 text-caption text-muted-fg">
              Team settings
            </p>
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
                onRequestClose?.();
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
              <SelectTrigger
                aria-label="Team settings"
                className="mb-2 h-7 w-full gap-2 px-2 text-caption font-normal text-fg"
                size="sm"
              >
                <HugeiconsIcon
                  icon={UserGroupIcon}
                  strokeWidth={1.5}
                  className="size-3.5 shrink-0"
                />
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
      )}
    </div>
  );
};
