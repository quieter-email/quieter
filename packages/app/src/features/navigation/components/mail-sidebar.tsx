"use client";

import {
  Cancel01Icon,
  Calendar03Icon,
  Edit01Icon,
  NoteEditIcon,
  Sorting05Icon,
} from "@hugeicons/core-free-icons";
import { ShortcutHint } from "@quieter/app/features/hotkeys/components/shortcut-hint";
import {
  loadComposeWorkspace,
  loadSnippetWorkspace,
} from "@quieter/app/features/mailbox/components/mailbox-workspace/workspace-component-loaders";
import type { MailboxWorkspaceView } from "@quieter/app/features/mailbox/domain/mailbox-workspace-view";
import { MailboxSwitcherDropdown } from "@quieter/app/features/navigation/components/mailbox-switcher";
import type { MailboxSwitcherOrder } from "@quieter/app/features/navigation/components/mailbox-switcher";
import { SidebarLabelNav } from "@quieter/app/features/navigation/components/sidebar-label-nav";
import { SidebarMailboxNav } from "@quieter/app/features/navigation/components/sidebar-mailbox-nav";
import { SidebarMailboxNavItem } from "@quieter/app/features/navigation/components/sidebar-nav-item";
import { SidebarEntrance } from "@quieter/app/features/navigation/components/sidebar-surfaces";
import type { MailboxCategory } from "@quieter/app/lib/mail";
import type { MailboxCapabilities } from "@quieter/mail/data-plane";
import { Button } from "@quieter/ui/button";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { WorkspaceSidebar } from "@quieter/ui/workspace-sidebar";
import { useEffect, useState } from "react";

import { SidebarFooterLinks } from "./sidebar-footer-links";
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
  selectedView?: MailboxWorkspaceView;
  isSnippetMailbox: boolean;
  onReorderMailboxSwitcher: (order: MailboxSwitcherOrder) => void;
  onReconnectMailbox: (mailbox: { emailAddress: string; id: string }) => void;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
  onSelectMailboxId: (mailboxId: string) => void;
  onSearch: (query: string) => void;
  onComposeNewMail: () => void;
  onManageLabels: (mailboxId?: string) => void;
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

const SidebarInboxSection = ({
  allInboxesActive = false,
  userId = "preview",
  animateEntrance,
  embedded,
  groups,
  onComposeNewMail,
  onManageLabels,
  onRequestClose,
  onSearch,
  onSelectMailbox,
  isSnippetMailbox,
  searchQuery,
  selectedMailbox,
  selectedMailboxId,
  selectedMailboxProvider,
  selectedView,
}: Pick<
  SidebarContentProps,
  | "animateEntrance"
  | "allInboxesActive"
  | "userId"
  | "embedded"
  | "groups"
  | "onComposeNewMail"
  | "onManageLabels"
  | "onRequestClose"
  | "onSearch"
  | "onSelectMailbox"
  | "isSnippetMailbox"
  | "searchQuery"
  | "selectedMailbox"
  | "selectedMailboxId"
  | "selectedMailboxProvider"
  | "selectedView"
>) => {
  const selectedMailboxGrantRole = groups
    .flatMap((group) => group.mailboxes)
    .find((mailbox) => mailbox.id === selectedMailboxId)?.grantRole;
  const handleComposeNewMail = () => {
    onComposeNewMail();
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
          onPointerDown={(event) => {
            if (event.button !== 0) {
              event.preventDefault();
              return;
            }
            void loadComposeWorkspace();
          }}
          type="button"
        >
          <Icon icon={Edit01Icon} />
          Compose
          {embedded !== true &&
          selectedMailboxProvider !== "api" &&
          selectedMailboxId ? (
            <ShortcutHint className="ml-auto" shortcutId="compose" />
          ) : null}
        </Button>
      </SidebarEntrance>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto p-1">
        {embedded === true ? null : (
          <SidebarEntrance
            animateEntrance={animateEntrance}
            className="mb-2 w-full"
            index={2}
          >
            <SidebarMailboxNavItem
              // oxlint-disable-next-line shadcn/no-restyle -- SidebarNavItem owns an animated surface with custom row spacing.
              className="justify-start gap-3 px-3 text-left"
              mailboxSearch={{
                mailboxId: selectedMailboxId,
                workspace: "calendar",
              }}
              onClick={onRequestClose}
              replace={false}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Icon aria-hidden tone="default" icon={Calendar03Icon} />
              Calendar
            </SidebarMailboxNavItem>
          </SidebarEntrance>
        )}
        <SidebarMailboxNav
          allInboxesActive={allInboxesActive}
          animateEntrance={animateEntrance}
          embedded={embedded === true}
          mailboxId={selectedMailboxId}
          mailboxProvider={selectedMailboxProvider}
          onRequestClose={onRequestClose}
          onSelectMailbox={onSelectMailbox}
          selectedMailbox={selectedMailbox}
        />
        {embedded !== true && selectedMailboxId !== null ? (
          <SidebarEntrance
            animateEntrance={animateEntrance}
            className="mt-4 w-full"
            index={10}
          >
            <nav aria-label="Mail tools" className="flex flex-col">
              <p className="mb-1 px-2 text-caption font-medium text-muted-fg">
                Tools
              </p>
              <SidebarMailboxNavItem
                active={isSnippetMailbox}
                aria-current={isSnippetMailbox ? "page" : undefined}
                // oxlint-disable shadcn/no-restyle -- The sidebar row uses its existing animated active styling.
                className="justify-start gap-3 px-3 text-left"
                // oxlint-enable shadcn/no-restyle
                mailboxSearch={{
                  mailbox: "snippets",
                  mailboxId: selectedMailboxId,
                  messageId: null,
                  threadId: null,
                  view: "inbox",
                  workspace: null,
                }}
                onClick={onRequestClose}
                onFocus={() => void loadSnippetWorkspace()}
                onMouseEnter={() => void loadSnippetWorkspace()}
                onPointerDown={() => void loadSnippetWorkspace()}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Icon tone="default" icon={NoteEditIcon} />
                Snippets
              </SidebarMailboxNavItem>
              {!allInboxesActive && selectedMailboxProvider === "managed" ? (
                <SidebarMailboxNavItem
                  active={selectedView === "rules"}
                  aria-current={selectedView === "rules" ? "page" : undefined}
                  // oxlint-disable-next-line shadcn/no-restyle -- Matches the existing sidebar navigation row.
                  className="justify-start gap-3 px-3 text-left"
                  mailboxSearch={{
                    mailbox: "inbox",
                    mailboxId: selectedMailboxId,
                    messageId: null,
                    threadId: null,
                    view: "rules",
                    workspace: null,
                  }}
                  onClick={onRequestClose}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Icon aria-hidden tone="default" icon={Sorting05Icon} />
                  Organize mailbox
                </SidebarMailboxNavItem>
              ) : null}
            </nav>
          </SidebarEntrance>
        ) : null}
        {allInboxesActive && (
          <UnifiedSidebarLabelNav
            groups={groups}
            selectedMailbox={selectedMailbox}
            mailboxId={selectedMailboxId}
            onRequestClose={onRequestClose}
            userId={userId}
            searchQuery={searchQuery}
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
            embedded={embedded === true}
            onRequestClose={onRequestClose}
            onManageLabels={onManageLabels}
            selectedMailbox={selectedMailbox}
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
    <SidebarFooterLinks onRequestClose={onRequestClose} />
  </SidebarEntrance>
);

const SidebarContent = ({
  allInboxesActive,
  userId,
  animateEntrance,
  embedded = false,
  groups,
  onComposeNewMail,
  onManageLabels,
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
  selectedView,
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
        selectedView={selectedView}
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
    }, 750);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [animateEntrance]);

  return (
    <WorkspaceSidebar
      animateEntrance={animateEntrance}
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
