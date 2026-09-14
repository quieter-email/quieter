"use client";

import { useHeadlessConsentUI } from "@c15t/react";
import {
  Cancel01Icon,
  Edit01Icon,
  HelpCircleIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, LinkButton } from "@quieter/ui/button";
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

import { loadComposeWorkspace } from "#/features/mailbox/components/mailbox-workspace/workspace-component-loaders";
import type { MailboxWorkspaceView } from "#/features/mailbox/domain/mailbox-workspace-view";
import { MailboxOrganizer } from "#/features/navigation/components/mailbox-organizer";
import { MailboxSwitcherDropdown } from "#/features/navigation/components/mailbox-switcher";
import type { MailboxSwitcherOrder } from "#/features/navigation/components/mailbox-switcher";
import { SidebarLabelNav } from "#/features/navigation/components/sidebar-label-nav";
import { SidebarMailboxNav } from "#/features/navigation/components/sidebar-mailbox-nav";
import { SidebarEntrance } from "#/features/navigation/components/sidebar-surfaces";
import type { MailboxCategory } from "#/lib/mail";

type MailSidebarProps = {
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
      groupName: string;
      provider: "api" | "gmail" | "managed";
      unreadNonSpamCount: number;
    }[];
    name: string;
  }[];
  selectedMailboxId: string | null;
  selectedMailboxProvider: "api" | "gmail" | "managed" | null;
  selectedMailbox: MailboxCategory | null;
  onReorderMailboxSwitcher: (order: MailboxSwitcherOrder) => void;
  onReconnectMailbox: (mailbox: { emailAddress: string; id: string }) => void;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
  onSelectMailboxId: (mailboxId: string) => void;
  onSetDefaultMailbox: (mailboxId: string | null) => void;
  onSearch: (query: string) => void;
  onComposeNewMail: () => void;
  onManageLabels: () => void;
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

const SidebarHelpMenu = ({
  onRequestClose,
}: {
  onRequestClose?: () => void;
}) => {
  const { openDialog } = useHeadlessConsentUI();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <DropdownMenu onOpenChange={setIsOpen} open={isOpen}>
      <div className="squircle relative rounded-md hover:bg-muted/60 dark:hover:bg-muted/40">
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
        <DropdownMenuItem
          onSelect={() => {
            onRequestClose?.();
            openDialog();
          }}
        >
          Privacy preferences
        </DropdownMenuItem>
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
  animateEntrance,
  embedded,
  groups,
  onComposeNewMail,
  onManageLabels,
  onRequestClose,
  onSearch,
  onSelectMailbox,
  searchQuery,
  selectedMailbox,
  selectedMailboxId,
  selectedMailboxProvider,
}: Pick<
  SidebarContentProps,
  | "animateEntrance"
  | "embedded"
  | "groups"
  | "onComposeNewMail"
  | "onManageLabels"
  | "onRequestClose"
  | "onSearch"
  | "onSelectMailbox"
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
          className="w-full justify-start rounded-md px-4"
          disabled={
            !selectedMailboxId ||
            embedded === true ||
            selectedMailboxProvider === "api"
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

      <div className="mt-2 min-h-0 flex-1 p-1">
        <SidebarMailboxNav
          animateEntrance={animateEntrance}
          mailboxProvider={selectedMailboxProvider}
          onSelectMailbox={handleSelectMailbox}
          selectedMailbox={selectedMailbox}
        />
        {selectedMailboxProvider === "managed" && selectedMailboxId ? (
          <MailboxOrganizer
            canManage={selectedMailboxGrantRole === "manager"}
            mailboxId={selectedMailboxId}
            searchQuery={searchQuery}
          />
        ) : null}
        {selectedMailboxProvider !== "api" && (
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
      <div className="squircle relative min-w-0 flex-1 rounded-md hover:bg-muted/60 dark:hover:bg-muted/40">
        <LinkButton
          aria-label="Settings"
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
  animateEntrance,
  defaultMailboxId,
  embedded = false,
  groups,
  onComposeNewMail,
  onReorderMailboxSwitcher,
  onReconnectMailbox,
  onRequestClose,
  onSelectMailbox,
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
        animateEntrance={animateEntrance}
        embedded={embedded}
        groups={groups}
        onComposeNewMail={onComposeNewMail}
        onManageLabels={() => {
          handleSelectView("labels");
        }}
        onRequestClose={onRequestClose}
        onSearch={onSearch}
        onSelectMailbox={onSelectMailbox}
        searchQuery={searchQuery}
        selectedMailbox={selectedMailbox}
        selectedMailboxId={selectedMailboxId}
        selectedMailboxProvider={selectedMailboxProvider}
      />

      {!embedded && (
        <SidebarFooter
          animateEntrance={animateEntrance}
          onRequestClose={onRequestClose}
        />
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
