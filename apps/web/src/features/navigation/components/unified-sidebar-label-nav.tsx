"use client";

import { MoreVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { ColorSwatch } from "@quieter/ui/color-swatch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { useQueries } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { Fragment, useEffect, useState } from "react";

import { useUnifiedInboxPreferences } from "#/features/mailbox/domain/unified-inbox";
import {
  SIDEBAR_LABEL_VISIBILITY_EVENT,
  SIDEBAR_LABEL_VISIBILITY_STORAGE_KEY,
  computeEffectiveHiddenLabelIds,
  readHiddenLabelIds,
} from "#/features/message-labels/domain/sidebar-label-visibility";
import { serializeStructuredSearchState } from "#/features/message-search/components/message-list-search/message-list-search-utils";
import {
  getUserLabels,
  normalizeLabelSelectionKey,
  parseStructuredSearchQuery,
} from "#/features/message-search/state/message-list-search-state";
import { SidebarNavItem } from "#/features/navigation/components/sidebar-nav-item";
import { labelsQueryOptions } from "#/lib/mail/labels-query";

import type { MailSidebar } from "./mail-sidebar";
import { MailboxOrganizer } from "./mailbox-organizer";

export const UnifiedSidebarLabelNav = ({
  groups,
  userId,
  onSearch,
  onManageLabels,
  searchQuery,
}: {
  groups: ComponentProps<typeof MailSidebar>["groups"];
  userId: string;
  searchQuery: string;
  onSearch: (query: string) => void;
  onManageLabels: (mailboxId?: string) => void;
}) => {
  const preferences = useUnifiedInboxPreferences(userId);
  const [rulesMailboxId, setRulesMailboxId] = useState<string | null>(null);
  const [, refreshHiddenLabels] = useState(0);
  const mailboxes = groups
    .flatMap((group) => group.mailboxes)
    .filter(
      (mailbox) =>
        mailbox.provider !== "api" &&
        mailbox.connectionStatus === "connected" &&
        !preferences.excludedIds.includes(mailbox.id)
    );
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
  const labels = [...labelsByName.entries()].toSorted(([left], [right]) =>
    left.localeCompare(right)
  );
  const rulesMailbox = mailboxes.find(
    (mailbox) => mailbox.id === rulesMailboxId && mailbox.provider === "managed"
  );

  return (
    <section className="mt-4">
      <div className="mb-1 flex items-center justify-between px-2">
        <p className="text-caption font-medium text-muted-fg">Labels</p>
        {mailboxes.length > 0 && (
          <DropdownMenu>
            <IconButtonTooltip label="Labels options">
              <DropdownMenuTrigger
                aria-label="Labels options"
                render={<Button size="icon-xs" variant="ghost" />}
              >
                <HugeiconsIcon
                  aria-hidden
                  className="size-3.5"
                  icon={MoreVerticalIcon}
                />
              </DropdownMenuTrigger>
            </IconButtonTooltip>
            <DropdownMenuContent align="end" size="compact">
              {mailboxes.map((mailbox) => (
                <Fragment key={mailbox.id}>
                  {(mailbox.provider === "gmail" ||
                    mailbox.grantRole === "manager") && (
                    <DropdownMenuItem
                      onSelect={() => {
                        onManageLabels(mailbox.id);
                      }}
                    >
                      Manage labels for {mailbox.emailAddress}
                    </DropdownMenuItem>
                  )}
                  {mailbox.provider === "managed" && (
                    <DropdownMenuItem
                      onSelect={() => {
                        setRulesMailboxId(mailbox.id);
                      }}
                    >
                      {mailbox.grantRole === "manager" ? "Manage" : "About"}{" "}
                      rules for {mailbox.emailAddress}
                    </DropdownMenuItem>
                  )}
                </Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <nav aria-label="Labels" className="flex flex-col">
        {mailboxes.length === 0 && (
          <p className="px-2 py-1 text-caption text-muted-fg">
            Select an inbox to see labels.
          </p>
        )}
        {labels.map(([nameKey, label]) => {
          const isActive = selectedLabelKeys.has(nameKey);
          return (
            <SidebarNavItem
              active={isActive}
              aria-pressed={isActive}
              // oxlint-disable shadcn/no-restyle -- SidebarNavItem owns an animated surface with custom label-row spacing.
              className={cn(
                "min-w-0 justify-start text-left text-caption font-normal squircle",
                {
                  "text-fg": isActive,
                  "text-muted-fg": !isActive,
                }
              )}
              // oxlint-enable shadcn/no-restyle
              key={nameKey}
              onClick={() => {
                onSearch(
                  serializeStructuredSearchState({
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
                  })
                );
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <ColorSwatch
                color={
                  label.color?.startsWith("#") === true
                    ? label.color
                    : `var(--q-${label.color ?? "gray"})`
                }
              />
              <span className="min-w-0 truncate">{label.name}</span>
            </SidebarNavItem>
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
      {rulesMailbox && (
        <MailboxOrganizer
          key={rulesMailbox.id}
          canManage={rulesMailbox.grantRole === "manager"}
          mailboxId={rulesMailbox.id}
          onOpenChange={(open) => {
            if (!open) {
              setRulesMailboxId(null);
            }
          }}
          open
          searchQuery={searchQuery}
          showTrigger={false}
        />
      )}
    </section>
  );
};
