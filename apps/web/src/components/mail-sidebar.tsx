"use client";

import {
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
  useColorMode,
} from "@quietr/ui";
import { usePathname, useRouter } from "next/navigation";
import { useQueryStates } from "nuqs";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import {
  mailboxSearchParams,
  serializeMailboxSearchParams,
  serializeSettingsSearchParams,
} from "~/lib/search-params";
import { SIDEBAR_WIDTH } from "./sidebar/sidebar-constants";
import { SidebarMailboxNav } from "./sidebar/sidebar-mailbox-nav";

type MailSidebarProps = {
  user: {
    email?: string | null;
    name?: string | null;
  };
  selectedMailbox: MailboxCategory;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
  onComposeNewMail: () => void;
};

export const MailSidebar = ({
  onComposeNewMail,
  onSelectMailbox,
  selectedMailbox,
  user,
}: MailSidebarProps) => {
  const pathname = usePathname();
  const router = useRouter();
  const [{ mailbox, messageId }] = useQueryStates(mailboxSearchParams);
  const { colorMode, isMounted, setColorMode } = useColorMode();

  const profileName = user.name?.trim() || user.email?.trim() || "Profile";
  const profileEmail = user.email?.trim() || "No email available";
  const currentLocation = serializeMailboxSearchParams(pathname, { mailbox, messageId });
  const settingsHref = serializeSettingsSearchParams("/settings", { from: currentLocation });
  const isDarkMode = isMounted && colorMode === "dark";

  return (
    <aside
      className="relative hidden h-full shrink-0 border-r border-border bg-background text-foreground lg:flex lg:flex-col"
      style={{ width: `${SIDEBAR_WIDTH}px` }}
    >
      <div className="flex min-h-0 flex-1 flex-col px-4 py-6">
        <div className="flex min-w-0 items-start justify-between gap-3 pl-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-foreground">
              {profileName}
            </p>
            <p className="mt-1 truncate text-xs text-muted-foreground">{profileEmail}</p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Settings"
              className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <HugeiconsIcon aria-hidden className="size-4" icon={Menu04Icon} />
            </DropdownMenuTrigger>

            <DropdownMenuContent className="min-w-48" side="right">
              <DropdownMenuItem
                closeOnSelect={false}
                onSelect={() => {
                  router.push(settingsHref);
                }}
              >
                <HugeiconsIcon aria-hidden className="size-4 shrink-0" icon={Settings01Icon} />
                Settings
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                closeOnSelect={false}
                onSelect={() => setColorMode(isDarkMode ? "light" : "dark")}
              >
                {!isMounted ? (
                  <>
                    <HugeiconsIcon aria-hidden className="size-4 shrink-0" icon={Moon01Icon} />
                    Theme
                  </>
                ) : isDarkMode ? (
                  <>
                    <HugeiconsIcon aria-hidden className="size-4 shrink-0" icon={Sun01Icon} />
                    Light mode
                  </>
                ) : (
                  <>
                    <HugeiconsIcon aria-hidden className="size-4 shrink-0" icon={Moon01Icon} />
                    Dark mode
                  </>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-6 p-1">
          <Button
            className="h-10 w-full justify-start rounded-md px-4"
            onClick={onComposeNewMail}
            type="button"
          >
            <HugeiconsIcon className="size-4 shrink-0" icon={Edit01Icon} />
            New Mail
          </Button>
        </div>

        <div className="mt-4 min-h-0 flex-1 p-1">
          <SidebarMailboxNav onSelectMailbox={onSelectMailbox} selectedMailbox={selectedMailbox} />
        </div>
      </div>
    </aside>
  );
};
