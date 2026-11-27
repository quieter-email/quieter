"use client";

import { MoreVerticalIcon } from "@hugeicons/core-free-icons";
import { applyMailboxSearchPatch } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import type { MailboxSearchPatch } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import { useUnifiedInboxPreferences } from "@quieter/app/features/mailbox/domain/unified-inbox";
import { MailboxLabelSwatch } from "@quieter/app/features/message-labels/components/mailbox-label-swatch";
import {
  SIDEBAR_LABEL_VISIBILITY_EVENT,
  SIDEBAR_LABEL_VISIBILITY_STORAGE_KEY,
  computeEffectiveHiddenLabelIds,
  readHiddenLabelIds,
} from "@quieter/app/features/message-labels/domain/sidebar-label-visibility";
import { serializeStructuredSearchState } from "@quieter/app/features/message-search/components/message-list-search/message-list-search-utils";
import {
  getUserLabels,
  normalizeLabelSelectionKey,
  parseStructuredSearchQuery,
} from "@quieter/app/features/message-search/state/message-list-search-state";
import type { MailSidebar } from "@quieter/app/features/navigation/components/mail-sidebar";
import { SidebarMailboxNavItem } from "@quieter/app/features/navigation/components/sidebar-nav-item";
import type { MailboxCategory } from "@quieter/app/lib/mail";
import { labelsQueryOptions } from "@quieter/app/lib/mail/labels-query";
import { mailboxSearchSchema } from "@quieter/app/route-search";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { Button } from "@quieter/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { useEffect, useEffectEvent, useState } from "react";

import { orderSidebarEntries } from "../domain/sidebar-preferences";
import type { SidebarEntry } from "../domain/sidebar-preferences";
import { SidebarContextMenu } from "./sidebar-context-menu";
import {
  SidebarLabelDialogs,
  useSidebarLabelFilterReplacement,
  useSidebarSearchNavigation,
} from "./sidebar-label-actions";
import type { SidebarLabelDialogState } from "./sidebar-label-actions";

export const UnifiedSidebarLabelNav = ({
  groups,
  mailboxId,
  userId,
  onItemsChange,
  onRequestClose,
  order,
  searchQuery,
  selectedMailbox,
}: {
  groups: ComponentProps<typeof MailSidebar>["groups"];
  mailboxId: string | null;
  userId: string;
  searchQuery: string;
  selectedMailbox: MailboxCategory | null;
  onItemsChange?: (items: readonly SidebarEntry[]) => void;
  onRequestClose?: () => void;
  order?: readonly string[];
}) => {
  const preferences = useUnifiedInboxPreferences(userId);
  const navigateSearch = useSidebarSearchNavigation();
  const replaceLabelFilters = useSidebarLabelFilterReplacement();
  const [labelDialog, setLabelDialog] =
    useState<SidebarLabelDialogState | null>(null);
  const [, refreshHiddenLabels] = useState(0);
  const mailboxes = groups
    .flatMap((group) => group.mailboxes)
    .filter(
      (mailbox) =>
        mailbox.provider !== "api" &&
        mailbox.connectionStatus === "connected" &&
        !preferences.excludedIds.includes(mailbox.id)
    );
  if (
    labelDialog !== null &&
    !mailboxes.some(
      (mailbox) =>
        mailbox.id === labelDialog.request.mailboxId &&
        (mailbox.provider === "gmail" || mailbox.grantRole === "manager")
    )
  ) {
    setLabelDialog(null);
  }
  const labelQueries = useQueries({
    queries: mailboxes.map((mailbox) => labelsQueryOptions(mailbox.id)),
  });

  useEffect(() => {
    const refresh = () => {
      refreshHiddenLabels((current) => current + 1);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === SIDEBAR_LABEL_VISIBILITY_STORAGE_KEY) {
        refresh();
      }
    };
    window.addEventListener(SIDEBAR_LABEL_VISIBILITY_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SIDEBAR_LABEL_VISIBILITY_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const labelsByName = new Map<
    string,
    { color: MailboxLabel["color"]; name: string }
  >();
  const labelOwnersByName = new Map<
    string,
    { label: MailboxLabel; mailbox: (typeof mailboxes)[number] }[]
  >();
  let loadingCount = 0;
  let errorCount = 0;
  for (const [index, mailbox] of mailboxes.entries()) {
    const query = labelQueries[index];
    if (query === undefined) {
      continue;
    }
    if (query.isPending && query.data === undefined) {
      loadingCount += 1;
    }
    if (query.isError) {
      errorCount += 1;
    }
    const userLabels = getUserLabels(query.data ?? []);
    const hiddenIds = computeEffectiveHiddenLabelIds(
      mailbox.provider === "managed" ? "managed" : "gmail",
      userLabels,
      readHiddenLabelIds(mailbox.id)
    );
    for (const label of userLabels) {
      const nameKey = normalizeLabelSelectionKey(label.name);
      labelOwnersByName.set(nameKey, [
        ...(labelOwnersByName.get(nameKey) ?? []),
        { label, mailbox },
      ]);
      if (hiddenIds.has(label.id) || labelsByName.has(nameKey)) {
        continue;
      }
      labelsByName.set(nameKey, {
        color: label.color,
        name: label.name.trim(),
      });
    }
  }

  const search = parseStructuredSearchQuery(searchQuery);
  const selectedLabelKeys = new Set(
    search.filters.flatMap((filter) =>
      filter.type === "label" ? [normalizeLabelSelectionKey(filter.value)] : []
    )
  );
  const labels = [...labelsByName.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([nameKey, label]) => ({ ...label, id: nameKey }));
  const navItems = labels.map((label) => ({
    color: label.color,
    id: label.id,
    label: label.name,
  }));
  const manageLinks = mailboxes.flatMap(
    (mailbox): { key: string; label: string; patch: MailboxSearchPatch }[] => [
      ...(mailbox.provider === "gmail" || mailbox.grantRole === "manager"
        ? [
            {
              key: `${mailbox.id}:labels`,
              label: `Manage labels for ${mailbox.emailAddress}`,
              patch: {
                chatId: mailbox.id === mailboxId ? undefined : null,
                mailboxId: mailbox.id,
                messageId: null,
                query: null,
                threadId: null,
                view: "labels" as const,
                workspace: null,
              },
            },
          ]
        : []),
      ...(mailbox.provider === "managed"
        ? [
            {
              key: `${mailbox.id}:rules`,
              label: `${mailbox.grantRole === "manager" ? "Manage" : "About"} rules for ${mailbox.emailAddress}`,
              patch: {
                chatId: mailbox.id === mailboxId ? undefined : null,
                mailbox: "inbox" as const,
                mailboxId: mailbox.id,
                messageId: null,
                threadId: null,
                view: "rules" as const,
                workspace: null,
              },
            },
          ]
        : []),
    ]
  );

  const navItemsKey = JSON.stringify(navItems);
  const reportNavItems = useEffectEvent(() => {
    onItemsChange?.(navItems);
  });
  useEffect(() => {
    reportNavItems();
  }, [navItemsKey, onItemsChange]);

  return (
    <section className="mt-4">
      <SidebarContextMenu
        actions={manageLinks.map((link) => ({
          label: link.label,
          onSelect: () => {
            navigateSearch(link.patch);
            onRequestClose?.();
          },
        }))}
      >
        <div className="mb-1 flex items-center justify-between px-3">
          <p className="text-caption font-medium text-muted-fg">Labels</p>
          {mailboxes.length > 0 && (
            <DropdownMenu>
              <IconButtonTooltip label="Labels options">
                <DropdownMenuTrigger
                  aria-label="Labels options"
                  render={
                    <Button
                      className="-me-1.25"
                      size="icon-xs"
                      variant="ghost"
                    />
                  }
                >
                  <Icon aria-hidden size={14} icon={MoreVerticalIcon} />
                </DropdownMenuTrigger>
              </IconButtonTooltip>
              <DropdownMenuContent align="end" size="compact">
                {manageLinks.map((link) => (
                  <DropdownMenuItem
                    key={link.key}
                    onSelect={onRequestClose}
                    render={
                      <Link
                        replace
                        resetScroll={false}
                        search={(previous) =>
                          applyMailboxSearchPatch(
                            mailboxSearchSchema.parse(previous),
                            link.patch
                          )
                        }
                        to="/"
                      />
                    }
                  >
                    {link.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </SidebarContextMenu>

      <nav aria-label="Labels" className="flex flex-col">
        {mailboxes.length === 0 && (
          <p className="px-2 py-1 text-caption text-muted-fg">
            Select an inbox to see labels.
          </p>
        )}
        {orderSidebarEntries(labels, order).map((label) => {
          const nameKey = label.id;
          const isActive =
            selectedMailbox !== null && selectedLabelKeys.has(nameKey);
          const nextQuery = serializeStructuredSearchState({
            ...search,
            filters: [
              ...search.filters.filter(
                (filter) =>
                  filter.type !== "label" ||
                  normalizeLabelSelectionKey(filter.value) !== nameKey
              ),
              ...(isActive
                ? []
                : [{ type: "label" as const, value: label.name }]),
            ],
          });
          const owners = labelOwnersByName.get(nameKey) ?? [];
          const owner =
            loadingCount === 0 && errorCount === 0 && owners.length === 1
              ? owners[0]
              : undefined;
          const editableOwner =
            owner !== undefined &&
            (owner.mailbox.provider === "gmail" ||
              owner.mailbox.grantRole === "manager")
              ? {
                  label: owner.label,
                  mailboxId: owner.mailbox.id,
                  mailboxProvider:
                    owner.mailbox.provider === "managed"
                      ? ("managed" as const)
                      : ("gmail" as const),
                }
              : undefined;
          const labelOnlyQuery = serializeStructuredSearchState({
            filters: [{ type: "label", value: label.name }],
            text: "",
          });
          return (
            <SidebarContextMenu
              key={nameKey}
              actions={[
                {
                  label: "Search in label",
                  onSelect: () => {
                    navigateSearch({
                      mailbox: selectedMailbox ?? "inbox",
                      mailboxId,
                      messageId: null,
                      query: labelOnlyQuery,
                      view: "all-inboxes",
                      workspace: null,
                    });
                    onRequestClose?.();
                  },
                },
                ...(editableOwner === undefined
                  ? []
                  : [
                      {
                        label: "Edit label",
                        onSelect: () => {
                          setLabelDialog({
                            open: true,
                            request: { ...editableOwner, kind: "edit" },
                          });
                        },
                      },
                      {
                        label: "Delete label",
                        onSelect: () => {
                          setLabelDialog({
                            open: true,
                            request: { ...editableOwner, kind: "delete" },
                          });
                        },
                        tone: "destructive" as const,
                      },
                    ]),
              ]}
            >
              <SidebarMailboxNavItem
                active={isActive}
                aria-current={isActive ? "page" : undefined}
                className="min-w-0"
                mailboxSearch={{
                  mailbox: selectedMailbox ?? "inbox",
                  mailboxId,
                  messageId: null,
                  query: nextQuery,
                  view: "all-inboxes",
                  workspace: null,
                }}
                onClick={onRequestClose}
                type="button"
                variant="ghost"
              >
                <span className="flex size-3.5 shrink-0 items-center justify-center">
                  <MailboxLabelSwatch color={label.color} />
                </span>
                <span className="min-w-0 truncate">{label.name}</span>
              </SidebarMailboxNavItem>
            </SidebarContextMenu>
          );
        })}
        {loadingCount > 0 && (
          <p className="px-2 py-1 text-caption text-muted-fg">
            Loading labels…
          </p>
        )}
        {errorCount > 0 && (
          <div className="flex items-center justify-between gap-2 px-2 py-1 text-caption text-destructive">
            <span>
              {errorCount === mailboxes.length
                ? "Could not load labels."
                : "Some labels could not load."}
            </span>
            <Button
              onClick={() => {
                void Promise.all(
                  labelQueries
                    .filter((query) => query.isError)
                    .map(async (query) => await query.refetch())
                );
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              Retry
            </Button>
          </div>
        )}
        {mailboxes.length > 0 &&
          labels.length === 0 &&
          loadingCount === 0 &&
          errorCount === 0 && (
            <p className="px-2 py-1 text-caption text-muted-fg">
              No labels shown.
            </p>
          )}
      </nav>
      <SidebarLabelDialogs
        onDeleted={(request) => {
          if (selectedMailbox === null) {
            return;
          }
          replaceLabelFilters({
            inScope: (route) => route.view === "all-inboxes",
            nextName: null,
            previousNames: [request.label.name],
          });
        }}
        onOpenChange={(open) => {
          setLabelDialog((current) => current && { ...current, open });
        }}
        onRenamed={(request, label) => {
          replaceLabelFilters({
            inScope: (route) => route.view === "all-inboxes",
            nextName: label.name,
            previousNames: [request.label.name],
          });
        }}
        state={labelDialog}
      />
    </section>
  );
};
