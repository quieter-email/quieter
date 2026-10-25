"use client";

import { useHeadlessConsentUI } from "@c15t/react/headless";
import {
  Cancel01Icon,
  Calendar03Icon,
  Edit01Icon,
  HelpCircleIcon,
  LayoutRightIcon,
  NoteEditIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { AssistantSidebarContext } from "@quieter/app/features/chat/components/assistant-sidebar-context";
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
import type { MailboxCategory } from "@quieter/app/lib/mail";
import { appRuntime } from "@quieter/app/runtime";
import type { MailboxCapabilities } from "@quieter/mail/data-plane";
import { Button, LinkButton } from "@quieter/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { WorkspaceSidebar } from "@quieter/ui/workspace-sidebar";
import { Link } from "@tanstack/react-router";
import { use, useEffect, useState } from "react";

import { UnifiedSidebarLabelNav } from "./unified-sidebar-label-nav";

type MailSidebarProps = {
  userId?: string;
  allInboxesActive?: boolean;
  embedded?: boolean;
  groups: {
    id: string;
    kind: "division" | "organization" | "unassigned";
    mailboxes: {
      capabilities: MailboxCapabilities;
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
  onSearch: (query: string) => void;
  onComposeNewMail: () => void;
  onOpenCalendar?: () => void;
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
            <Icon aria-hidden icon={HelpCircleIcon} />
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
  userId = "preview",
  animateEntrance,
  embedded,
  groups,
  onComposeNewMail,
  onManageLabels,
  onManageSnippets,
  onOpenCalendar,
  onRequestClose,
  onSearch,
  onSelectMailbox,
  isSnippetMailbox,
  searchQuery,
  selectedMailbox,
  selectedMailboxId,
  selectedMailboxProvider,
}: Pick<
  SidebarContentProps,
  | "animateEntrance"
  | "allInboxesActive"
  | "userId"
  | "embedded"
  | "groups"
  | "onComposeNewMail"
  | "onManageLabels"
  | "onManageSnippets"
  | "onOpenCalendar"
  | "onRequestClose"
  | "onSearch"
  | "onSelectMailbox"
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
          <Icon icon={Edit01Icon} />
          Compose
        </Button>
      </SidebarEntrance>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto p-1">
        {embedded !== true && onOpenCalendar ? (
          <SidebarNavItem
            onClick={() => {
              onOpenCalendar();
              onRequestClose?.();
            }}
            type="button"
          >
            <Icon aria-hidden icon={Calendar03Icon} />
            Calendar
          </SidebarNavItem>
        ) : null}
        <SidebarMailboxNav
          animateEntrance={animateEntrance}
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
              className="justify-start gap-3 px-3 text-left"
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
              <Icon tone="default" icon={NoteEditIcon} />
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
          <Icon icon={Settings01Icon} />
          Settings
        </LinkButton>
      </div>
      <SidebarHelpMenu onRequestClose={onRequestClose} />
    </div>
  </SidebarEntrance>
);

const SidebarAssistantAction = ({
  onRequestClose,
}: {
  onRequestClose?: () => void;
}) => {
  const assistant = use(AssistantSidebarContext);
  if (
    !assistant ||
    assistant.open ||
    (!assistant.showNavigationTrigger && !onRequestClose)
  ) {
    return null;
  }
  return (
    <div className="px-2">
      <SidebarNavItem
        aria-controls={assistant.panelId}
        aria-expanded={assistant.open}
        data-assistant-launcher
        onClick={(event) => {
          assistant.onOpen(event.currentTarget);
          onRequestClose?.();
        }}
        type="button"
      >
        <Icon aria-hidden icon={LayoutRightIcon} />
        Open assistant
      </SidebarNavItem>
    </div>
  );
};

const SidebarContent = ({
  allInboxesActive,
  userId,
  animateEntrance,
  embedded = false,
  groups,
  onComposeNewMail,
  onManageLabels,
  onManageSnippets,
  onOpenCalendar,
  onReorderMailboxSwitcher,
  onReconnectMailbox,
  onRequestClose,
  onSelectMailbox,
  isSnippetMailbox,
  onSelectMailboxId,
  onSelectView,
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
          embedded={embedded}
          groups={groups}
          onReorderMailboxSwitcher={onReorderMailboxSwitcher}
          onReconnectMailbox={onReconnectMailbox}
          onSelectMailboxId={handleSelectMailboxId}
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
              <Icon aria-hidden icon={Cancel01Icon} />
            </Button>
          </IconButtonTooltip>
        )}
      </SidebarEntrance>

      <SidebarInboxSection
        userId={userId}
        allInboxesActive={allInboxesActive}
        animateEntrance={animateEntrance}
        embedded={embedded}
        groups={groups}
        onComposeNewMail={onComposeNewMail}
        onManageSnippets={onManageSnippets}
        onOpenCalendar={onOpenCalendar}
        onManageLabels={(sourceMailboxId) => {
          onManageLabels(sourceMailboxId);
          onRequestClose?.();
        }}
        onRequestClose={onRequestClose}
        onSearch={onSearch}
        onSelectMailbox={onSelectMailbox}
        isSnippetMailbox={isSnippetMailbox}
        searchQuery={searchQuery}
        selectedMailbox={selectedMailbox}
        selectedMailboxId={selectedMailboxId}
        selectedMailboxProvider={selectedMailboxProvider}
      />

      {!embedded && (
        <>
          <SidebarAssistantAction onRequestClose={onRequestClose} />
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
