"use client";

import {
  Cancel01Icon,
  Chat01Icon,
  Edit01Icon,
  InboxIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, cn, IconButtonTooltip, LinkButton } from "@quieter/ui";
import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";
import { useEffect, useEffectEvent } from "react";
import type { MailboxWorkspaceView } from "~/features/mailbox/domain/mailbox-workspace-view";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import {
  type MailboxSwitcherOrder,
  MailboxSwitcherDropdown,
} from "~/features/navigation/components/mailbox-switcher";
import { SidebarLabelNav } from "~/features/navigation/components/sidebar-label-nav";
import { SidebarMailboxNav } from "~/features/navigation/components/sidebar-mailbox-nav";

type MailSidebarProps = {
  defaultMailboxId: string | null;
  groups: Array<{
    id: string;
    kind: "personal" | "team";
    mailboxes: Array<{
      id: string;
      emailAddress: string;
      displayName: string | null;
      groupName: string;
      provider: string;
    }>;
    name: string;
  }>;
  selectedMailboxId: string | null;
  selectedMailbox: MailboxCategory;
  onReorderMailboxSwitcher: (order: MailboxSwitcherOrder) => void;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
  onSelectMailboxId: (mailboxId: string) => void;
  onSetDefaultMailbox: (mailboxId: string | null) => void;
  onSearch: (query: string) => void;
  onComposeNewMail: () => void;
  onSelectView: (view: MailboxWorkspaceView) => void;
  searchQuery: string;
  selectedView: MailboxWorkspaceView;
  isMobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
};

type SidebarContentProps = Omit<MailSidebarProps, "isMobileOpen" | "onMobileOpenChange"> & {
  onRequestClose?: () => void;
  switcherSide?: "bottom" | "right";
};

const getSidebarEntranceDelay = (step: number) => step * 0.1;

const SidebarContent = ({
  defaultMailboxId,
  groups,
  onComposeNewMail,
  onReorderMailboxSwitcher,
  onRequestClose,
  onSelectMailbox,
  onSelectMailboxId,
  onSelectView,
  onSetDefaultMailbox,
  onSearch,
  searchQuery,
  selectedMailboxId,
  selectedMailbox,
  selectedView,
  switcherSide = "right",
}: SidebarContentProps) => {
  const isInboxView = selectedView === "inbox";

  const handleComposeNewMail = () => {
    onComposeNewMail();
    onRequestClose?.();
  };

  const handleSelectMailbox = (mailbox: MailboxCategory) => {
    onSelectMailbox(mailbox);
    onRequestClose?.();
  };

  const handleSelectMailboxId = (mailboxId: string) => {
    onSelectMailboxId(mailboxId);
    onRequestClose?.();
  };

  const handleSelectView = (view: MailboxWorkspaceView) => {
    onSelectView(view);
    onRequestClose?.();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <m.div
        className="flex min-w-0 items-start gap-2 rounded-md will-change-[transform,opacity,filter]"
        initial={{ opacity: 0, x: -20, filter: "blur(8px)" }}
        animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
        transition={{ delay: getSidebarEntranceDelay(0), duration: 0.5, ease: "easeOut" }}
      >
        <MailboxSwitcherDropdown
          defaultMailboxId={defaultMailboxId}
          groups={groups}
          onReorderMailboxSwitcher={onReorderMailboxSwitcher}
          onSelectMailboxId={handleSelectMailboxId}
          onSetDefaultMailbox={onSetDefaultMailbox}
          selectedMailboxId={selectedMailboxId}
          side={switcherSide}
        />

        {onRequestClose && (
          <IconButtonTooltip label="Close sidebar">
            <Button
              aria-label="Close sidebar"
              className="-mr-2 lg:hidden"
              onClick={onRequestClose}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon aria-hidden icon={Cancel01Icon} />
            </Button>
          </IconButtonTooltip>
        )}
      </m.div>

      <m.div
        aria-label="Workspace view"
        className="relative mt-3 grid grid-cols-2 rounded-lg border border-border/60 bg-muted/70 p-0.5 will-change-[transform,opacity,filter]"
        role="group"
        initial={{ opacity: 0, x: -20, filter: "blur(8px)" }}
        animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
        transition={{ delay: getSidebarEntranceDelay(1), duration: 0.5, ease: "easeOut" }}
      >
        <m.div
          aria-hidden
          className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2px)] rounded-md bg-background shadow-sm"
          initial={false}
          animate={{ x: isInboxView ? 0 : "100%" }}
          transition={{ type: "spring", stiffness: 420, damping: 36 }}
        />
        <button
          aria-pressed={isInboxView}
          className={cn(
            "relative z-10 flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-[color,transform] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
            {
              "text-foreground": isInboxView,
              "text-muted-foreground hover:text-foreground": !isInboxView,
            },
          )}
          onClick={() => handleSelectView("inbox")}
          type="button"
        >
          <HugeiconsIcon
            className="size-3.5 shrink-0"
            icon={InboxIcon}
            strokeWidth={isInboxView ? 2.25 : 1.5}
          />
          <span>Inbox</span>
        </button>
        <button
          aria-pressed={!isInboxView}
          className={cn(
            "relative z-10 flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-[color,transform] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
            {
              "text-foreground": !isInboxView,
              "text-muted-foreground hover:text-foreground": isInboxView,
            },
          )}
          onClick={() => handleSelectView("chat")}
          type="button"
        >
          <HugeiconsIcon
            className="size-3.5 shrink-0"
            icon={Chat01Icon}
            strokeWidth={isInboxView ? 1.5 : 2.25}
          />
          <span>Chat</span>
        </button>
      </m.div>

      {isInboxView && (
        <m.div
          className="mt-3 p-1 will-change-[transform,opacity,filter]"
          initial={{ opacity: 0, x: -20, filter: "blur(8px)" }}
          animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
          transition={{ delay: getSidebarEntranceDelay(2), duration: 0.5, ease: "easeOut" }}
        >
          <Button
            className="w-full justify-start rounded-md px-4 transition-[font-weight,scale] hover:font-bold active:font-bold [&_svg_*]:transition-[stroke-width] hover:[&_svg_*]:stroke-3 active:[&_svg_*]:stroke-3"
            disabled={!selectedMailboxId}
            onClick={handleComposeNewMail}
            type="button"
          >
            <HugeiconsIcon className="size-4 shrink-0" icon={Edit01Icon} strokeWidth={1.5} />
            Compose
          </Button>
        </m.div>
      )}

      {isInboxView && (
        <>
          <div className="mt-4 min-h-0 flex-1 p-1">
            <SidebarMailboxNav
              onSelectMailbox={handleSelectMailbox}
              selectedMailbox={selectedMailbox}
            />
            <SidebarLabelNav
              mailboxId={selectedMailboxId}
              onSearch={(query) => {
                onSearch(query);
                onRequestClose?.();
              }}
              searchQuery={searchQuery}
            />
          </div>
          <m.div
            className="mt-auto p-2 will-change-[transform,opacity,filter]"
            initial={{ opacity: 0, x: -20, filter: "blur(8px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            transition={{ delay: getSidebarEntranceDelay(9), duration: 0.5, ease: "easeOut" }}
          >
            <LinkButton
              aria-label="Settings"
              className="group w-full justify-start transition-[font-weight,scale] hover:font-extrabold active:font-extrabold [&_svg_*]:transition-[stroke-width] hover:[&_svg_*]:stroke-3 active:[&_svg_*]:stroke-3"
              onClick={onRequestClose}
              search={{
                from: "/",
                tab: "general",
              }}
              variant="ghost"
              to="/settings"
            >
              <HugeiconsIcon
                className="size-4 shrink-0 rotate-0 transition-transform duration-1000 ease-in-out group-hover:rotate-360"
                icon={Settings01Icon}
                strokeWidth={1.5}
              />
              Settings
            </LinkButton>
          </m.div>
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
  const closeMobileSidebar = useEffectEvent(() => {
    onMobileOpenChange(false);
  });

  useEffect(() => {
    if (!isMobileOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMobileSidebar();
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMobileOpen]);

  return (
    <LazyMotion features={domAnimation}>
      <>
        <aside
          className="relative hidden h-full shrink-0 bg-background text-foreground lg:flex lg:flex-col"
          style={{ width: "248px" }}
        >
          <SidebarContent {...sidebarProps} />
        </aside>

        <AnimatePresence initial={false}>
          {isMobileOpen && (
            <>
              <m.button
                aria-label="Close sidebar"
                className="fixed inset-0 z-40 bg-background-dark/50 backdrop-blur-[2px] lg:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => onMobileOpenChange(false)}
                type="button"
              />
              <m.aside
                aria-label="Mail sidebar"
                className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,calc(100vw-2.5rem))] flex-col bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-foreground shadow-2xl lg:hidden"
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ type: "spring", bounce: 0, duration: 0.24 }}
              >
                <SidebarContent
                  {...sidebarProps}
                  onRequestClose={() => onMobileOpenChange(false)}
                  switcherSide="bottom"
                />
              </m.aside>
            </>
          )}
        </AnimatePresence>
      </>
    </LazyMotion>
  );
};
