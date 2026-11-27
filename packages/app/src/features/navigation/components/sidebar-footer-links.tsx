"use client";

import { useHeadlessConsentUI } from "@c15t/react/headless";
import {
  HelpCircleIcon,
  KeyboardIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { useKeyboardShortcuts } from "@quieter/app/features/hotkeys/components/keyboard-shortcuts-context";
import { ShortcutHint } from "@quieter/app/features/hotkeys/components/shortcut-hint";
import { SidebarNavItem } from "@quieter/app/features/navigation/components/sidebar-nav-item";
import { appRuntime } from "@quieter/app/runtime";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";

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
  const { openKeyboardShortcuts } = useKeyboardShortcuts();

  return (
    <DropdownMenu onOpenChange={setIsOpen} open={isOpen}>
      <div className="relative shrink-0 rounded-md hover:bg-control-hover">
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
          onSelect={() => {
            onRequestClose?.();
            openKeyboardShortcuts();
          }}
        >
          <Icon aria-hidden icon={KeyboardIcon} />
          Keyboard shortcuts
          <ShortcutHint
            className="ml-auto"
            shortcutId="show-keyboard-shortcuts"
          />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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

export const SidebarFooterLinks = ({
  onRequestClose,
}: {
  onRequestClose?: () => void;
}) => {
  const returnTo = useLocation({ select: (location) => location.href });
  return (
    <div className="flex items-center gap-1">
      <SidebarNavItem
        onClick={onRequestClose}
        nativeButton={false}
        render={<Link search={{ from: returnTo }} to="/settings" />}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- The shared Button renders a native anchor through its render slot.
        role="link"
      >
        <Icon icon={Settings01Icon} />
        Settings
      </SidebarNavItem>
      <SidebarHelpMenu onRequestClose={onRequestClose} />
    </div>
  );
};
