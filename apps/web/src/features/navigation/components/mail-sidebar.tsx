"use client";

import { Cancel01Icon, Edit01Icon, Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, IconButtonTooltip, LinkButton } from "@quieter/ui";
import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";
import { useEffect, useEffectEvent } from "react";
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
  searchQuery: string;
  isMobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
};

type SidebarContentProps = Omit<MailSidebarProps, "isMobileOpen" | "onMobileOpenChange"> & {
  onRequestClose?: () => void;
  switcherSide?: "bottom" | "right";
};

const SidebarContent = ({
  defaultMailboxId,
  groups,
  onComposeNewMail,
  onReorderMailboxSwitcher,
  onRequestClose,
  onSelectMailbox,
  onSelectMailboxId,
  onSetDefaultMailbox,
  onSearch,
  searchQuery,
  selectedMailboxId,
  selectedMailbox,
  switcherSide = "right",
}: SidebarContentProps) => {
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

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <div className="flex min-w-0 items-start gap-2 rounded-md">
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
      </div>

      <div className="mt-3 p-1">
        <Button
          className="w-full justify-start rounded-md px-4"
          disabled={!selectedMailboxId}
          onClick={handleComposeNewMail}
          type="button"
        >
          <HugeiconsIcon className="size-4 shrink-0" icon={Edit01Icon} />
          Compose
        </Button>
      </div>

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
      <div className="mt-auto p-2">
        <LinkButton
          aria-label="Settings"
          className="w-full justify-start"
          onClick={onRequestClose}
          search={{
            from: "/",
            tab: "general",
          }}
          variant="ghost"
          to="/settings"
        >
          <HugeiconsIcon className="size-4 shrink-0" icon={Settings01Icon} />
          Settings
        </LinkButton>
      </div>
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
    <>
      <aside
        className="relative hidden h-full shrink-0 bg-background text-foreground lg:flex lg:flex-col"
        style={{ width: "248px" }}
      >
        <SidebarContent {...sidebarProps} />
      </aside>

      <LazyMotion features={domAnimation}>
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
      </LazyMotion>
    </>
  );
};
