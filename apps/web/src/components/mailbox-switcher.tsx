"use client";

import type { ReactNode } from "react";
import { Loading03Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSubmenu,
  DropdownMenuSubmenuContent,
  DropdownMenuSubmenuTrigger,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectList,
  SelectTrigger,
  SelectValue,
  cn,
  toast,
} from "@quietr/ui";
import { mutationOptions, useMutation } from "@tanstack/react-query";
import { authClient } from "~/lib/auth";
import { getErrorMessage, unwrapResultError } from "~/lib/errors";

export type MailboxSwitcherMailbox = {
  displayName: string | null;
  emailAddress: string;
  id: string;
};

type OrganizationSummary = {
  id: string;
  name: string;
};

type MailboxSummaryProps = {
  action?: ReactNode;
  className?: string;
  isActive?: boolean;
  mailbox: MailboxSwitcherMailbox;
};

type OrganizationSwitcherSelectProps = {
  onOrganizationChange?: () => void;
};

type MailboxSwitcherDropdownProps = {
  activeOrganizationName: string | null;
  mailboxes: MailboxSwitcherMailbox[];
  onSelectMailboxId: (mailboxId: string) => void;
  selectedMailboxId: string | null;
};

const getMailboxTitle = (mailbox: MailboxSwitcherMailbox) => mailbox.emailAddress;

const getMailboxSubtitle = () => null;

const MailboxSummary = ({ action, className, isActive = false, mailbox }: MailboxSummaryProps) => (
  <div
    className={cn("flex min-w-0 items-center justify-between gap-3 rounded-md", className, {
      "bg-muted/70": isActive,
    })}
  >
    <div className="min-w-0">
      <p className="truncate text-sm text-foreground">{getMailboxTitle(mailbox)}</p>
      {getMailboxSubtitle() ? (
        <p className="truncate text-xs text-muted-foreground">{getMailboxSubtitle()}</p>
      ) : null}
    </div>

    {action}
  </div>
);

const useOrganizationSwitcher = () => {
  const activeOrganizationState = authClient.useActiveOrganization();
  const organizationsState = authClient.useListOrganizations();
  const organizations = (organizationsState.data ?? []).map((organization) => ({
    id: organization.id,
    name: organization.name,
  })) satisfies OrganizationSummary[];
  const activeOrganizationId = activeOrganizationState.data?.id ?? null;
  const setActiveOrganizationMutation = useMutation(
    mutationOptions({
      mutationFn: async (organizationId: string) =>
        unwrapResultError(
          await authClient.organization.setActive({ organizationId }),
          "Could not switch organization.",
        ),
      mutationKey: ["auth", "organization", "set-active"],
    }),
  );

  const setActiveOrganization = async (organizationId: string) => {
    if (!organizationId || organizationId === activeOrganizationId) {
      return;
    }

    try {
      await setActiveOrganizationMutation.mutateAsync(organizationId);
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not switch organization."));
    }
  };

  return {
    activeOrganization: activeOrganizationState.data ?? null,
    activeOrganizationId,
    isPending: setActiveOrganizationMutation.isPending,
    organizations,
    setActiveOrganization,
  };
};

const OrganizationSwitcherSubmenu = ({ onOrganizationChange }: OrganizationSwitcherSelectProps) => {
  const { activeOrganizationId, isPending, organizations, setActiveOrganization } =
    useOrganizationSwitcher();
  const activeOrganizationName =
    organizations.find((organization) => organization.id === activeOrganizationId)?.name ??
    "organization";

  return (
    <DropdownMenuSubmenu>
      <DropdownMenuSubmenuTrigger>
        <div className="flex min-w-0 items-center gap-2">
          <HugeiconsIcon
            aria-hidden
            className={cn("size-4 shrink-0", {
              "animate-spin": isPending,
            })}
            icon={isPending ? Loading03Icon : UserGroupIcon}
          />
          <span className="truncate">{activeOrganizationName}</span>
        </div>
      </DropdownMenuSubmenuTrigger>

      <DropdownMenuSubmenuContent className="w-64 p-1">
        {organizations.map((organization) => (
          <DropdownMenuItem
            className={cn({
              "bg-muted/70": organization.id === activeOrganizationId,
            })}
            closeOnSelect={false}
            key={organization.id}
            onSelect={() => {
              onOrganizationChange?.();
              void setActiveOrganization(organization.id);
            }}
          >
            <span className="truncate">{organization.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubmenuContent>
    </DropdownMenuSubmenu>
  );
};

export const OrganizationSwitcherSelect = ({
  onOrganizationChange,
}: OrganizationSwitcherSelectProps) => {
  const { activeOrganizationId, isPending, organizations, setActiveOrganization } =
    useOrganizationSwitcher();
  const organizationSelectItems = organizations.map((organization) => ({
    label: organization.name,
    value: organization.id,
  }));

  return (
    <Select
      items={organizationSelectItems}
      modal={false}
      onValueChange={(value) => {
        if (!value) {
          return;
        }

        onOrganizationChange?.();
        void setActiveOrganization(value);
      }}
      value={activeOrganizationId ?? undefined}
    >
      <SelectTrigger aria-label="Switch organization" className="h-8">
        <HugeiconsIcon
          aria-hidden
          className={cn("size-4 shrink-0", {
            "animate-spin": isPending,
          })}
          icon={isPending ? Loading03Icon : UserGroupIcon}
        />
        <SelectValue placeholder="organization" />
      </SelectTrigger>

      <SelectContent positionerClassName="z-[60]">
        <SelectList>
          {organizations.map((organization) => (
            <SelectItem key={organization.id} value={organization.id}>
              {organization.name}
            </SelectItem>
          ))}
        </SelectList>
      </SelectContent>
    </Select>
  );
};

export const MailboxSwitcherDropdown = ({
  activeOrganizationName,
  mailboxes,
  onSelectMailboxId,
  selectedMailboxId,
}: MailboxSwitcherDropdownProps) => {
  const selectedMailbox =
    mailboxes.find((mailbox) => mailbox.id === selectedMailboxId) ?? mailboxes[0] ?? null;
  const primaryLabel = selectedMailbox?.emailAddress ?? "no mailbox";
  const secondaryLabel = activeOrganizationName ?? "no organization";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch mailbox"
        className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="min-w-0">
          <p className="truncate text-[13px] leading-5 font-medium tracking-tight text-foreground">
            {primaryLabel}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{secondaryLabel}</p>
        </div>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-80 p-2" side="right" sideOffset={10}>
        <OrganizationSwitcherSubmenu />

        <DropdownMenuSeparator className="my-2" />

        <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {mailboxes.length > 0 ? (
            mailboxes.map((mailbox) => {
              const isActive = mailbox.id === selectedMailboxId;

              return (
                <DropdownMenuItem
                  className="h-auto px-1 py-1"
                  key={mailbox.id}
                  onSelect={() => onSelectMailboxId(mailbox.id)}
                >
                  <MailboxSummary
                    className="w-full px-2 py-1.5"
                    isActive={isActive}
                    mailbox={mailbox}
                  />
                </DropdownMenuItem>
              );
            })
          ) : (
            <div className="rounded-md px-2.5 py-2 text-sm text-muted-foreground">no mailbox</div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const MailboxSettingsRow = ({
  action,
  className,
  mailbox,
}: Omit<MailboxSummaryProps, "isActive">) => (
  <div className={cn("flex items-center justify-between gap-3 py-3", className)}>
    <MailboxSummary className="min-w-0 flex-1" mailbox={mailbox} />
    {action ? <div className="shrink-0">{action}</div> : null}
  </div>
);
