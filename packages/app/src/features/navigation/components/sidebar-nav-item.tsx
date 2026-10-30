"use client";

import { applyMailboxSearchPatch } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import type { MailboxSearchPatch } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import {
  SidebarActiveSurface,
  sidebarNavButtonVariants,
} from "@quieter/app/features/navigation/components/sidebar-surfaces";
import { mailboxSearchSchema } from "@quieter/app/route-search";
import { Button } from "@quieter/ui/button";
import type { ButtonProps } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Link } from "@tanstack/react-router";
import type { MouseEventHandler, ReactNode } from "react";

type SidebarNavItemProps = Omit<
  ButtonProps,
  "onMouseEnter" | "onMouseLeave"
> & {
  active?: boolean;
  activeSurfaceClassName?: string;
  children: ReactNode;
  onMouseEnter?: MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: MouseEventHandler<HTMLDivElement>;
  trailing?: ReactNode;
};

export const SidebarNavItem = ({
  active,
  activeSurfaceClassName,
  children,
  className,
  onBlur,
  onFocus,
  onMouseEnter,
  onMouseLeave,
  trailing,
  variant = "ghost",
  ...buttonProps
}: SidebarNavItemProps) => (
  <div
    className={cn(
      "group relative flex w-full items-center rounded-md py-px squircle",
      {
        "hover:bg-muted": active !== true,
      }
    )}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
  >
    {active === true ? (
      <SidebarActiveSurface className={activeSurfaceClassName} />
    ) : null}
    <Button
      // oxlint-disable-next-line shadcn/require-static-classes -- Forwards the caller's classes to the shared button.
      className={cn(sidebarNavButtonVariants(), className)}
      onBlur={onBlur}
      onFocus={onFocus}
      variant={variant}
      {...buttonProps}
    >
      {children}
    </Button>
    {trailing}
  </div>
);

export const SidebarMailboxNavItem = ({
  mailboxSearch,
  replace = true,
  ...props
}: SidebarNavItemProps & {
  mailboxSearch?: MailboxSearchPatch;
  replace?: boolean;
}) => (
  <SidebarNavItem
    {...props}
    {...(mailboxSearch === undefined
      ? {}
      : {
          nativeButton: false,
          render: (
            <Link
              replace={replace}
              resetScroll={false}
              search={(previous) =>
                applyMailboxSearchPatch(
                  mailboxSearchSchema.parse(previous),
                  mailboxSearch
                )
              }
              to="/"
            />
          ),
          role: "link",
        })}
  />
);
