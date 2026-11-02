"use client";

import {
  ArrowLeft01Icon,
  ArrowDown01Icon,
  Add01Icon,
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
import { SidebarNavItem } from "@quieter/app/features/navigation/components/sidebar-nav-item";
import {
  fullOrganizationQueryOptions,
  hasOrganizationPermission,
  normalizeOrganizationRole,
} from "@quieter/app/features/settings/components/organization-settings/domain";
import { OrganizationFormDialog } from "@quieter/app/features/settings/components/organization-settings/organization-form-dialog";
import { useSettingsTeam } from "@quieter/app/features/settings/components/use-settings-team";
import { isDemoModeAvailable } from "@quieter/app/features/settings/domain/demo-mode-setting";
import {
  settingsDestinationSearch,
  settingsTeamSection,
  TEAM_SETTINGS_NAV,
} from "@quieter/app/features/settings/domain/settings-destination";
import type { SettingsDestination } from "@quieter/app/features/settings/domain/settings-destination";
import { authClient } from "@quieter/app/lib/auth";
import { settingsRouteApi } from "@quieter/app/lib/route-apis";
import { Button } from "@quieter/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

const SETTINGS_ICONS: Record<string, typeof Settings01Icon> = {
  "API keys": Key01Icon,
  Account: UserIcon,
  "Billing & usage": CreditCardIcon,
  "Blocked recipients": MailSend02Icon,
  "Connected apps": Plug01Icon,
  Delivery: MailSend02Icon,
  Development: CodeIcon,
  Divisions: UserGroupIcon,
  Domains: GlobeIcon,
  General: Settings01Icon,
  Mailboxes: Mail01Icon,
  "Members & invitations": UserGroupIcon,
  Memories: AiChat01Icon,
  Preferences: Settings01Icon,
};

const PERSONAL_ITEMS = [
  { tab: "account", title: "Account" },
  { tab: "appearance", title: "Preferences" },
  { tab: "ai", title: "Memories" },
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
  const [isCreateTeamOpen, setIsCreateTeamOpen] = useState(false);
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
  const navigationLink = (
    title: string,
    destination: SettingsDestination,
    selected: boolean
  ) => (
    <SidebarNavItem
      active={selected}
      key={title}
      aria-current={selected ? "page" : undefined}
      className="justify-start text-left"
      nativeButton={false}
      onClick={onRequestClose}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- The shared Button renders an anchor through its render slot.
      role="link"
      render={
        <Link
          search={(previous) => ({
            ...previous,
            ...settingsDestinationSearch(destination, teamId),
          })}
          to="/settings"
        />
      }
      variant="ghost"
      size="sm"
    >
      <Icon icon={SETTINGS_ICONS[title] ?? Settings01Icon} tone="default" />
      {title}
    </SidebarNavItem>
  );
  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6">
      <div className="mb-3 flex items-center justify-between px-1">
        <Button
          className="justify-start"
          nativeButton={false}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- The shared Button renders an anchor through its render slot.
          role="link"
          render={<Link to={from} />}
          variant="ghost"
          size="sm"
        >
          <Icon icon={ArrowLeft01Icon} />
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
              <Icon icon={Cancel01Icon} />
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
              navigationLink(
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
              navigationLink(
                "Development",
                { tab: "development" },
                tab === "development"
              )}
          </div>
          <div className="space-y-0">
            <p className="px-2 py-1 text-caption text-muted-fg">
              Team settings
            </p>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Team settings"
                render={
                  <Button className="mb-2 w-full" size="sm" variant="outline" />
                }
              >
                <Icon icon={UserGroupIcon} size={14} />
                <span className="min-w-0 flex-1 truncate text-left">
                  {team?.name ??
                    (organizationsState.isPending
                      ? "Loading teams"
                      : "Choose a team")}
                </span>
                <Icon icon={ArrowDown01Icon} size={14} tone="muted" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" size="compact">
                {organizations.map((item) => (
                  <DropdownMenuCheckboxItem
                    checked={item.id === team?.id}
                    closeOnSelect
                    key={item.id}
                    nativeButton={false}
                    onClick={onRequestClose}
                    render={
                      <Link
                        search={(previous) => ({
                          ...previous,
                          domainId: "",
                          mailboxId: "",
                          mailboxView: "list",
                          organizationId: item.id,
                          section:
                            previous.mailboxId !== "" ||
                            previous.domainId !== ""
                              ? ""
                              : previous.section,
                        })}
                        to="/settings"
                      />
                    }
                  >
                    {item.name}
                  </DropdownMenuCheckboxItem>
                ))}
                {organizations.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  nativeButton={false}
                  onSelect={onRequestClose}
                  render={
                    <Link
                      search={(previous) => ({
                        ...previous,
                        ...settingsDestinationSearch(
                          { organizationId: "", tab: "organization" },
                          teamId
                        ),
                      })}
                      to="/settings"
                    />
                  }
                >
                  <Icon icon={UserGroupIcon} size={14} />
                  Teams & invitations
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setIsCreateTeamOpen(true);
                  }}
                >
                  <Icon icon={Add01Icon} size={14} />
                  Create team
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <OrganizationFormDialog
              open={isCreateTeamOpen}
              onOpenChange={setIsCreateTeamOpen}
            />
            {organizationsState.error && (
              <p role="alert" className="px-3 text-caption text-destructive">
                Could not load teams.
              </p>
            )}
            {team && (
              <>
                {TEAM_SETTINGS_NAV.flatMap((item) =>
                  (item.view === "delivery" || item.view === "suppressions") &&
                  !canManage ? (
                    []
                  ) : (
                    <div key={item.view}>
                      {navigationLink(
                        item.title,
                        { organizationView: item.view, tab: "organization" },
                        tab === "organization" &&
                          organizationId !== "" &&
                          settingsTeamSection(organizationView) === item.view
                      )}
                      {item.view === "members" &&
                        navigationLink(
                          "Mailboxes",
                          { tab: "mailboxes" },
                          tab === "mailboxes"
                        )}
                    </div>
                  )
                )}
              </>
            )}
          </div>
        </nav>
      )}
    </div>
  );
};
