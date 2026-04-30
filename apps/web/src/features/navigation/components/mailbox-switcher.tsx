"use client";

import type { ReactNode } from "react";
import { Loading03Icon, PinIcon, PinOffIcon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PERSONAL_WORKSPACE_ID,
  toOrganizationId,
  toWorkspaceId,
  type WorkspaceId,
} from "@quieter/auth/workspace";
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
} from "@quieter/ui";
import { useMutation } from "@tanstack/react-query";
import { authClient } from "~/lib/auth";
import { getErrorMessage, unwrapResultError } from "~/lib/errors";

type MailboxSwitcherMailbox = {
  displayName: string | null;
  emailAddress: string;
  id: string;
  provider: string;
};

type WorkspaceSummary = {
  id: string;
  name: string;
};

type MailboxSummaryProps = {
  action?: ReactNode;
  className?: string;
  mailbox: MailboxSwitcherMailbox;
};

type WorkspaceSwitcherSelectProps = {
  onWorkspaceChange?: () => void;
};

type MailboxSwitcherDropdownProps = {
  defaultMailboxId: string | null;
  mailboxes: MailboxSwitcherMailbox[];
  onSelectMailboxId: (mailboxId: string) => void;
  onSetDefaultMailbox: (mailboxId: string | null) => void;
  selectedMailboxId: string | null;
  workspaceName: string;
};

const MailboxSummary = ({ action, className, mailbox }: MailboxSummaryProps) => (
  <div className={cn("flex min-w-0 items-center justify-between gap-3 rounded-md", className)}>
    <div className="min-w-0">
      <p className="truncate text-sm text-foreground">{mailbox.emailAddress}</p>
    </div>

    {action}
  </div>
);

const useWorkspaceSwitcher = () => {
  const activeOrganizationState = authClient.useActiveOrganization();
  const organizationsState = authClient.useListOrganizations();
  const workspaces = [
    { id: PERSONAL_WORKSPACE_ID, name: "Personal" },
    ...(organizationsState.data ?? []).map((organization) => ({
      id: organization.id,
      name: organization.name,
    })),
  ] satisfies WorkspaceSummary[];
  const workspaceId = toWorkspaceId(activeOrganizationState.data?.id);
  const setWorkspaceMutation = useMutation({
    mutationFn: async (nextWorkspaceId: WorkspaceId) =>
      unwrapResultError(
        await authClient.organization.setActive({
          organizationId: toOrganizationId(nextWorkspaceId),
        }),
        "Could not switch workspace.",
      ),
    mutationKey: ["auth", "organization", "set-active"],
  });

  const setWorkspace = async (nextWorkspaceId: WorkspaceId) => {
    if (nextWorkspaceId === workspaceId) {
      return;
    }

    try {
      await setWorkspaceMutation.mutateAsync(nextWorkspaceId);
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not switch workspace."));
    }
  };

  return {
    isPending: setWorkspaceMutation.isPending,
    setWorkspace,
    workspaceId,
    workspaces,
  };
};

const WorkspaceSwitcherSubmenu = ({ onWorkspaceChange }: WorkspaceSwitcherSelectProps) => {
  const { isPending, setWorkspace, workspaceId, workspaces } = useWorkspaceSwitcher();
  const workspaceName =
    workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? "Personal";

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
          <span className="truncate">{workspaceName}</span>
        </div>
      </DropdownMenuSubmenuTrigger>

      <DropdownMenuSubmenuContent className="w-64 p-1">
        {workspaces.map((workspace) => (
          <DropdownMenuItem
            className={cn({
              "bg-muted/70": workspace.id === workspaceId,
            })}
            closeOnSelect={false}
            key={workspace.id}
            onSelect={() => {
              onWorkspaceChange?.();
              void setWorkspace(workspace.id);
            }}
          >
            <span className="truncate">{workspace.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubmenuContent>
    </DropdownMenuSubmenu>
  );
};

export const WorkspaceSwitcherSelect = ({ onWorkspaceChange }: WorkspaceSwitcherSelectProps) => {
  const { isPending, setWorkspace, workspaceId, workspaces } = useWorkspaceSwitcher();
  const workspaceSelectItems = workspaces.map((workspace) => ({
    label: workspace.name,
    value: workspace.id,
  }));

  return (
    <Select
      items={workspaceSelectItems}
      modal={false}
      onValueChange={(value) => {
        if (!value) {
          return;
        }

        onWorkspaceChange?.();
        void setWorkspace(value);
      }}
      value={workspaceId}
    >
      <SelectTrigger aria-label="Switch workspace" className="h-8">
        <HugeiconsIcon
          aria-hidden
          className={cn("size-4 shrink-0", {
            "animate-spin": isPending,
          })}
          icon={isPending ? Loading03Icon : UserGroupIcon}
        />
        <SelectValue placeholder="workspace" />
      </SelectTrigger>

      <SelectContent positionerClassName="z-[60]">
        <SelectList>
          {workspaces.map((workspace) => (
            <SelectItem key={workspace.id} value={workspace.id}>
              {workspace.name}
            </SelectItem>
          ))}
        </SelectList>
      </SelectContent>
    </Select>
  );
};

export const MailboxSwitcherDropdown = ({
  defaultMailboxId,
  mailboxes,
  onSelectMailboxId,
  onSetDefaultMailbox,
  selectedMailboxId,
  workspaceName,
}: MailboxSwitcherDropdownProps) => {
  const selectedMailbox =
    mailboxes.find((mailbox) => mailbox.id === selectedMailboxId) ?? mailboxes[0] ?? null;
  const primaryLabel = selectedMailbox?.emailAddress ?? "no mailbox";

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
          <p className="mt-1 truncate text-xs text-muted-foreground">{workspaceName}</p>
        </div>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-80" side="right" sideOffset={10}>
        <WorkspaceSwitcherSubmenu />

        <DropdownMenuSeparator />

        <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {mailboxes.length > 0 ? (
            mailboxes.map((mailbox) => {
              const isActive = mailbox.id === selectedMailboxId;
              const isDefault = mailbox.id === defaultMailboxId;

              return (
                <DropdownMenuItem
                  className={cn("group/item", {
                    "bg-muted/70": isActive,
                  })}
                  key={mailbox.id}
                  onSelect={() => onSelectMailboxId(mailbox.id)}
                >
                  <MailboxSummary
                    action={
                      <button
                        aria-label={isDefault ? "Unset default mailbox" : "Set as default mailbox"}
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
                          {
                            "text-foreground": isDefault,
                            "text-muted-foreground/50 opacity-0 group-hover/item:opacity-100 hover:text-foreground":
                              !isDefault,
                          },
                        )}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSetDefaultMailbox(isDefault ? null : mailbox.id);
                        }}
                        type="button"
                      >
                        <HugeiconsIcon
                          aria-hidden
                          className="size-3.5"
                          icon={isDefault ? PinIcon : PinOffIcon}
                        />
                      </button>
                    }
                    className="w-full"
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

export const MailboxSettingsRow = ({ action, className, mailbox }: MailboxSummaryProps) => (
  <div className={cn("flex items-center justify-between gap-3 py-3", className)}>
    <MailboxSummary className="min-w-0 flex-1" mailbox={mailbox} />
    {action && <div className="shrink-0">{action}</div>}
  </div>
);
