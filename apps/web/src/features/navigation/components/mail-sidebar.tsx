"use client";

import {
  ComputerIcon,
  Edit01Icon,
  Menu04Icon,
  Moon01Icon,
  Settings01Icon,
  Sun01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButtonTooltip,
  useColorMode,
} from "@quietr/ui";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import { MailboxSwitcherDropdown } from "~/features/navigation/components/mailbox-switcher";
import { SidebarMailboxNav } from "~/features/navigation/components/sidebar-mailbox-nav";
import { inboxRouteApi } from "~/lib/route-apis";
import { serializeMailboxSearchParams, toSettingsSearch } from "~/lib/search-params";

type MailSidebarProps = {
  activeOrganizationName: string | null;
  defaultMailboxId: string | null;
  mailboxes: Array<{
    id: string;
    emailAddress: string;
    displayName: string | null;
  }>;
  selectedMailboxId: string | null;
  selectedMailbox: MailboxCategory;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
  onSelectMailboxId: (mailboxId: string) => void;
  onSetDefaultMailbox: (mailboxId: string | null) => void;
  onComposeNewMail: () => void;
};

export const MailSidebar = ({
  activeOrganizationName,
  defaultMailboxId,
  mailboxes,
  onComposeNewMail,
  onSelectMailbox,
  onSelectMailboxId,
  onSetDefaultMailbox,
  selectedMailboxId,
  selectedMailbox,
}: MailSidebarProps) => {
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { mailbox, messageId, query } = inboxRouteApi.useSearch();
  const { configColorMode, cycleColorMode, isMounted } = useColorMode();
  const currentLocation = serializeMailboxSearchParams(pathname, { mailbox, messageId, query });

  return (
    <aside
      className="relative hidden h-full shrink-0 border-r border-border bg-background-dark text-foreground lg:flex lg:flex-col"
      style={{ width: "248px" }}
    >
      <div className="flex min-h-0 flex-1 flex-col px-3 py-6">
        <div className="flex min-w-0 items-start justify-between gap-3 pl-2">
          <MailboxSwitcherDropdown
            activeOrganizationName={activeOrganizationName}
            defaultMailboxId={defaultMailboxId}
            mailboxes={mailboxes}
            onSelectMailboxId={onSelectMailboxId}
            onSetDefaultMailbox={onSetDefaultMailbox}
            selectedMailboxId={selectedMailboxId}
          />

          <DropdownMenu>
            <IconButtonTooltip label="Profile options">
              <DropdownMenuTrigger
                aria-label="Profile options"
                className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <HugeiconsIcon aria-hidden className="size-4" icon={Menu04Icon} />
              </DropdownMenuTrigger>
            </IconButtonTooltip>

            <DropdownMenuContent className="min-w-48" side="right">
              <DropdownMenuItem
                closeOnSelect={false}
                onSelect={() => {
                  void navigate({
                    search: toSettingsSearch({
                      from: currentLocation,
                    }),
                    to: "/settings",
                  });
                }}
              >
                <HugeiconsIcon aria-hidden className="size-4 shrink-0" icon={Settings01Icon} />
                Settings
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem closeOnSelect={false} onSelect={() => cycleColorMode()}>
                {!isMounted ? (
                  <>
                    <HugeiconsIcon aria-hidden className="size-4 shrink-0" icon={Moon01Icon} />
                    Theme
                  </>
                ) : configColorMode === "light" ? (
                  <>
                    <HugeiconsIcon aria-hidden className="size-4 shrink-0" icon={Moon01Icon} />
                    Dark mode
                  </>
                ) : configColorMode === "dark" ? (
                  <>
                    <HugeiconsIcon aria-hidden className="size-4 shrink-0" icon={ComputerIcon} />
                    System
                  </>
                ) : (
                  <>
                    <HugeiconsIcon aria-hidden className="size-4 shrink-0" icon={Sun01Icon} />
                    Light mode
                  </>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-6 p-1">
          <Button
            className="w-full justify-start rounded-md px-4"
            disabled={!selectedMailboxId}
            onClick={onComposeNewMail}
            type="button"
          >
            <HugeiconsIcon className="size-4 shrink-0" icon={Edit01Icon} />
            Compose
          </Button>
        </div>

        <div className="mt-4 min-h-0 flex-1 p-1">
          <SidebarMailboxNav onSelectMailbox={onSelectMailbox} selectedMailbox={selectedMailbox} />
        </div>
      </div>
    </aside>
  );
};
