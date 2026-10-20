"use client";

import { useHeadlessConsentUI } from "@c15t/react/headless";
import {
  Cancel01Icon,
  Edit01Icon,
  HelpCircleIcon,
  NoteEditIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  loadComposeWorkspace,
  loadSnippetWorkspace,
} from "@quieter/app/features/mailbox/components/mailbox-workspace/workspace-component-loaders";
import type { MailboxWorkspaceView } from "@quieter/app/features/mailbox/domain/mailbox-workspace-view";
import { MailboxOrganizer } from "@quieter/app/features/navigation/components/mailbox-organizer";
import { MailboxSwitcherDropdown } from "@quieter/app/features/navigation/components/mailbox-switcher";
import type { MailboxSwitcherOrder } from "@quieter/app/features/navigation/components/mailbox-switcher";
import { SidebarLabelNav } from "@quieter/app/features/navigation/components/sidebar-label-nav";
import { SidebarMailboxNav } from "@quieter/app/features/navigation/components/sidebar-mailbox-nav";
import { SidebarNavItem } from "@quieter/app/features/navigation/components/sidebar-nav-item";
import { SidebarEntrance } from "@quieter/app/features/navigation/components/sidebar-surfaces";
import { UnifiedSidebarLabelNav } from "@quieter/app/features/navigation/components/unified-sidebar-label-nav";
import type { MailboxCategory } from "@quieter/app/lib/mail";
import { appRuntime } from "@quieter/app/runtime";
import { Button, LinkButton } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { WorkspaceSidebar } from "@quieter/ui/workspace-sidebar";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

type MailSidebarProps = {
  userId?: string;
  allInboxesActive?: boolean;
  dailyBriefActive?: boolean;
  defaultMailboxId: string | null;
  embedded?: boolean;
  groups: {
    id: string;
    kind: "division" | "organization" | "unassigned";
    mailboxes: {
      connectionStatus: "connected" | "needs_reconnect";
      divisionName?: string | null;
      grantRole?: "manager" | "reader" | "responder" | null;
      id: string;
      emailAddress: string;
      displayName: string | null;
      signatureHtml?: string | null;
      signatureText?: string | null;
      groupName: string;
      provider: "api" | "gmail" | "managed";
      unreadNonSpamCount: number;
    }[];
    name: string;
  }[];
  selectedMailboxId: string | null;
  selectedMailboxProvider: "api" | "gmail" | "managed" | null;
  selectedMailbox: MailboxCategory | null;
  isSnippetMailbox: boolean;
  onReorderMailboxSwitcher: (order: MailboxSwitcherOrder) => void;
  onReconnectMailbox: (mailbox: { emailAddress: string; id: string }) => void;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
  onSelectMailboxId: (mailboxId: string) => void;
  onSetDefaultMailbox: (mailboxId: string | null) => void;
  onSearch: (query: string) => void;
  onComposeNewMail: () => void;
  onManageLabels: (mailboxId?: string) => void;
  onManageSnippets: () => void;
  onSelectView: (view: MailboxWorkspaceView) => void;
  reconnectingMailboxId: string | null;
  searchQuery: string;
  isMobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
};

type SidebarContentProps = Omit<
  MailSidebarProps,
  "isMobileOpen" | "onMobileOpenChange"
> & {
  animateEntrance: boolean;
  onRequestClose?: () => void;
  switcherSide?: "bottom" | "right";
};

let hasPlayedSidebarEntrance = false;

const BrowserPrivacyPreferencesItem = ({
  onRequestClose,
}: {
  onRequestClose?: () => void;
}) => {
  const { openDialog } = useHeadlessConsentUI();

  return (
    <DropdownMenuItem
      onSelect={() => {
        onRequestClose?.();
        openDialog();
      }}
    >
      Privacy preferences
    </DropdownMenuItem>
  );
};

const SidebarHelpMenu = ({
  onRequestClose,
}: {
  onRequestClose?: () => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <DropdownMenu onOpenChange={setIsOpen} open={isOpen}>
      <div className="relative rounded-md squircle hover:bg-muted/60 dark:hover:bg-muted/40">
        <IconButtonTooltip label="Help and legal">
          <DropdownMenuTrigger
            appearance="icon-transparent"
            aria-label="Help and legal"
            className="relative z-10"
          >
            <HugeiconsIcon
              aria-hidden
              className="size-4"
              icon={HelpCircleIcon}
              strokeWidth={1.5}
            />
          </DropdownMenuTrigger>
        </IconButtonTooltip>
      </div>
      <DropdownMenuContent align="end" side="top" size="compact">
        <DropdownMenuItem
          onSelect={onRequestClose}
          render={<Link to="/privacy" />}
        >
          Privacy
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onRequestClose}
          render={<Link to="/cookies" />}
        >
          Cookies
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onRequestClose}
          render={<Link to="/terms" />}
        >
          Terms
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onRequestClose}
          render={<Link to="/imprint" />}
        >
          Imprint
        </DropdownMenuItem>
        {appRuntime.platform === "desktop" ? null : (
          <BrowserPrivacyPreferencesItem onRequestClose={onRequestClose} />
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={
            <a href="https://logo.dev" rel="noreferrer" target="_blank">
              Logos by logo.dev
            </a>
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const SidebarInboxSection = ({
  allInboxesActive = false,
  dailyBriefActive = false,
  userId = "preview",
  animateEntrance,
  embedded,
  groups,
  onComposeNewMail,
  onManageLabels,
  onManageSnippets,
  onRequestClose,
  onSearch,
  onSelectMailbox,
  onSelectView,
  isSnippetMailbox,
  searchQuery,
  selectedMailbox,
  selectedMailboxId,
  selectedMailboxProvider,
}: Pick<
  SidebarContentProps,
  | "animateEntrance"
  | "allInboxesActive"
  | "dailyBriefActive"
  | "userId"
  | "embedded"
  | "groups"
  | "onComposeNewMail"
  | "onManageLabels"
  | "onManageSnippets"
  | "onRequestClose"
  | "onSearch"
  | "onSelectMailbox"
  | "onSelectView"
  | "isSnippetMailbox"
  | "searchQuery"
  | "selectedMailbox"
  | "selectedMailboxId"
  | "selectedMailboxProvider"
>) => {
  const selectedMailboxGrantRole = groups
    .flatMap((group) => group.mailboxes)
    .find((mailbox) => mailbox.id === selectedMailboxId)?.grantRole;
  const handleComposeNewMail = () => {
    onComposeNewMail();
    onRequestClose?.();
  };
  const handleSelectMailbox = (mailbox: MailboxCategory) => {
    onSelectMailbox(mailbox);
    onRequestClose?.();
  };
  return (
    <>
      <SidebarEntrance
        animateEntrance={animateEntrance}
        className="mt-3 p-1"
        index={2}
      >
        <Button
          aria-disabled={embedded === true || selectedMailboxProvider === "api"}
          // oxlint-disable-next-line shadcn/no-restyle -- Compose action stays full-width and left-aligned.
          className="w-full justify-start px-4"
          disabled={
            !selectedMailboxId ||
            embedded === true ||
            selectedMailboxProvider === "api" ||
            (allInboxesActive
              ? !groups.some((group) =>
                  group.mailboxes.some(
                    (mailbox) =>
                      mailbox.provider !== "api" &&
                      mailbox.connectionStatus === "connected" &&
                      mailbox.grantRole !== "reader"
                  )
                )
              : selectedMailboxGrantRole === "reader")
          }
          onClick={handleComposeNewMail}
          onFocus={() => void loadComposeWorkspace()}
          onMouseEnter={() => void loadComposeWorkspace()}
          onPointerDown={() => void loadComposeWorkspace()}
          type="button"
        >
          <HugeiconsIcon
            className="size-4 shrink-0"
            icon={Edit01Icon}
            strokeWidth={1.5}
          />
          Compose
        </Button>
      </SidebarEntrance>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto p-1">
        <SidebarMailboxNav
          animateEntrance={animateEntrance}
          brief={
            embedded !== true &&
            groups.some((group) =>
              group.mailboxes.some((mailbox) => mailbox.provider !== "api")
            )
              ? {
                  active: dailyBriefActive,
                  onSelect: () => {
                    onSelectView("daily-brief");
                    onRequestClose?.();
                  },
                }
              : undefined
          }
          mailboxProvider={selectedMailboxProvider}
          onSelectMailbox={handleSelectMailbox}
          selectedMailbox={selectedMailbox}
        />
        {embedded !== true && selectedMailboxId !== null ? (
          <SidebarEntrance
            animateEntrance={animateEntrance}
            className="w-full"
            index={10}
          >
            <SidebarNavItem
              active={isSnippetMailbox}
              aria-current={isSnippetMailbox ? "page" : undefined}
              // oxlint-disable shadcn/no-restyle -- The sidebar row uses its existing animated active styling.
              className={cn("w-full justify-start gap-3 px-3 text-left", {
                "text-fg": isSnippetMailbox,
                "text-muted-fg": !isSnippetMailbox,
              })}
              // oxlint-enable shadcn/no-restyle
              onClick={() => {
                onManageSnippets();
                onRequestClose?.();
              }}
              onFocus={() => void loadSnippetWorkspace()}
              onMouseEnter={() => void loadSnippetWorkspace()}
              onPointerDown={() => void loadSnippetWorkspace()}
              size="sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon
                className="shrink-0 text-fg"
                icon={NoteEditIcon}
                strokeWidth={1.5}
              />
              Snippets
            </SidebarNavItem>
          </SidebarEntrance>
        ) : null}
        {!allInboxesActive &&
        selectedMailboxProvider === "managed" &&
        selectedMailboxId ? (
          <MailboxOrganizer
            canManage={selectedMailboxGrantRole === "manager"}
            mailboxId={selectedMailboxId}
            searchQuery={searchQuery}
          />
        ) : null}
        {allInboxesActive && (
          <UnifiedSidebarLabelNav
            groups={groups}
            userId={userId}
            searchQuery={searchQuery}
            onManageLabels={onManageLabels}
            onSearch={(nextQuery) => {
              onSearch(nextQuery);
              onRequestClose?.();
            }}
          />
        )}
        {!allInboxesActive && selectedMailboxProvider !== "api" && (
          <SidebarLabelNav
            animateEntrance={animateEntrance}
            canManage={
              embedded !== true &&
              (selectedMailboxProvider === "gmail" ||
                selectedMailboxGrantRole === "manager")
            }
            mailboxId={selectedMailboxId}
            mailboxProvider={selectedMailboxProvider ?? "gmail"}
            onManageLabels={onManageLabels}
            onSearch={(query) => {
              onSearch(query);
              onRequestClose?.();
            }}
            searchQuery={searchQuery}
          />
        )}
      </div>
    </>
  );
};

const SidebarFooter = ({
  animateEntrance,
  onRequestClose,
}: Pick<SidebarContentProps, "animateEntrance" | "onRequestClose">) => (
  <SidebarEntrance
    animateEntrance={animateEntrance}
    className="mt-auto p-2"
    index={9}
  >
    <div className="flex items-center gap-1">
      <div className="relative min-w-0 flex-1 rounded-md squircle hover:bg-muted/60 dark:hover:bg-muted/40">
        <LinkButton
          aria-label="Settings"
          // oxlint-disable-next-line shadcn/no-restyle -- Sidebar settings link keeps its row treatment.
          className="group relative z-10 w-full justify-start bg-transparent hover:bg-transparent active:scale-100"
          onClick={onRequestClose}
          search={{
            from: "/",
          }}
          variant="ghost"
          to="/settings"
        >
          <HugeiconsIcon
            className="size-4 shrink-0"
            icon={Settings01Icon}
            strokeWidth={1.5}
          />
          Settings
        </LinkButton>
      </div>
      <SidebarHelpMenu onRequestClose={onRequestClose} />
    </div>
  </SidebarEntrance>
);

const SidebarContent = ({
  allInboxesActive,
  dailyBriefActive,
  userId,
  animateEntrance,
  defaultMailboxId,
  embedded = false,
  groups,
  onComposeNewMail,
  onManageLabels,
  onManageSnippets,
  onReorderMailboxSwitcher,
  onReconnectMailbox,
  onRequestClose,
  onSelectMailbox,
  isSnippetMailbox,
  onSelectMailboxId,
  onSelectView,
  onSetDefaultMailbox,
  onSearch,
  reconnectingMailboxId,
  searchQuery,
  selectedMailboxId,
  selectedMailbox,
  selectedMailboxProvider,
  switcherSide = "right",
}: SidebarContentProps) => {
  const handleSelectMailboxId = (mailboxId: string) => {
    onSelectMailboxId(mailboxId);
    onRequestClose?.();
  };

  const handleSelectView = (view: MailboxWorkspaceView) => {
    onSelectView(view);
    onRequestClose?.();
  };

  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col p-6">
      <SidebarEntrance
        animateEntrance={animateEntrance}
        className="flex min-w-0 items-start gap-2 rounded-md px-1"
      >
        <MailboxSwitcherDropdown
          allInboxesActive={allInboxesActive}
          onSelectAllInboxes={
            embedded
              ? undefined
              : () => {
                  handleSelectView("all-inboxes");
                }
          }
          defaultMailboxId={defaultMailboxId}
          embedded={embedded}
          groups={groups}
          onReorderMailboxSwitcher={onReorderMailboxSwitcher}
          onReconnectMailbox={onReconnectMailbox}
          onSelectMailboxId={handleSelectMailboxId}
          onSetDefaultMailbox={onSetDefaultMailbox}
          reconnectingMailboxId={reconnectingMailboxId}
          selectedMailboxId={selectedMailboxId}
          side={switcherSide}
        />

        {onRequestClose && (
          <IconButtonTooltip label="Close sidebar">
            <Button
              aria-label="Close sidebar"
              className="lg:hidden"
              onClick={onRequestClose}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon aria-hidden icon={Cancel01Icon} />
            </Button>
          </IconButtonTooltip>
        )}
      </SidebarEntrance>

      <SidebarInboxSection
        userId={userId}
        allInboxesActive={allInboxesActive}
        dailyBriefActive={dailyBriefActive}
        animateEntrance={animateEntrance}
        embedded={embedded}
        groups={groups}
        onComposeNewMail={onComposeNewMail}
        onManageSnippets={onManageSnippets}
        onManageLabels={(sourceMailboxId) => {
          onManageLabels(sourceMailboxId);
          onRequestClose?.();
        }}
        onRequestClose={onRequestClose}
        onSearch={onSearch}
        onSelectMailbox={onSelectMailbox}
        onSelectView={onSelectView}
        isSnippetMailbox={isSnippetMailbox}
        searchQuery={searchQuery}
        selectedMailbox={selectedMailbox}
        selectedMailboxId={selectedMailboxId}
        selectedMailboxProvider={selectedMailboxProvider}
      />

      {!embedded && (
        <>
          {!onRequestClose &&
          selectedMailboxId &&
          selectedMailboxProvider !== "api" ? (
            <div className="flex h-24 shrink-0 items-center px-2">
              <div aria-hidden className="size-[50px]" data-assistant-dock />
            </div>
          ) : null}
          <SidebarFooter
            animateEntrance={animateEntrance}
            onRequestClose={onRequestClose}
          />
        </>
      )}
    </div>
  );
};

export const MailSidebar = ({
  isMobileOpen,
  onMobileOpenChange,
  ...sidebarProps
}: MailSidebarProps) => {
  const [animateEntrance, setAnimateEntrance] = useState(
    () => !hasPlayedSidebarEntrance
  );

  useEffect((): (() => void) | undefined => {
    if (!animateEntrance) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      hasPlayedSidebarEntrance = true;
      setAnimateEntrance(false);
    }, 650);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [animateEntrance]);

  return (
    <WorkspaceSidebar
      isMobileOpen={isMobileOpen}
      onMobileOpenChange={onMobileOpenChange}
      label="Mail sidebar"
    >
      {(close) => (
        <SidebarContent
          {...sidebarProps}
          animateEntrance={animateEntrance}
          onRequestClose={close}
          switcherSide={close ? "bottom" : undefined}
        />
      )}
    </WorkspaceSidebar>
  );
};
