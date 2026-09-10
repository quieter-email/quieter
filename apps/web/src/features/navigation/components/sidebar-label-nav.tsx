"use client";

import { MoreVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useReducer } from "react";

import { mailboxLabelDotClassNameByColor } from "#/features/message-labels/domain/mailbox-label-presentation";
import {
  SIDEBAR_LABEL_VISIBILITY_EVENT,
  computeEffectiveHiddenLabelIds,
  createHiddenLabelState,
  readHiddenLabelIds,
  reduceHiddenLabelState,
} from "#/features/message-labels/domain/sidebar-label-visibility";
import { serializeStructuredSearchState } from "#/features/message-search/components/message-list-search/message-list-search-utils";
import {
  getUserLabels,
  normalizeLabelSelectionKey,
  parseStructuredSearchQuery,
} from "#/features/message-search/state/message-list-search-state";
import { SidebarNavItem } from "#/features/navigation/components/sidebar-nav-item";
import { SidebarEntrance } from "#/features/navigation/components/sidebar-surfaces";
import { labelsQueryOptions } from "#/lib/gmail/labels-query";
import { managedLabelCountsQueryOptions } from "#/lib/managed-mailbox-organization-query";

type SidebarLabelNavProps = {
  animateEntrance: boolean;
  canManage: boolean;
  mailboxId: string | null;
  mailboxProvider: "gmail" | "managed";
  onManageLabels: () => void;
  onSearch: (query: string) => void;
  searchQuery: string;
};

const ManagedLabelColorDot = ({
  className,
  color,
}: {
  className?: string;
  color: MailboxLabel["color"] | null | undefined;
}) => (
  <span
    aria-hidden
    className={cn(
      "inline-flex size-3 shrink-0 rounded-full",
      mailboxLabelDotClassNameByColor[color ?? "gray"],
      className
    )}
  />
);

const SidebarLabelEntrance = ({
  animateEntrance,
  children,
  index,
}: {
  animateEntrance: boolean;
  children: ReactNode;
  index: number;
}) => (
  <SidebarEntrance
    animateEntrance={animateEntrance}
    className="w-full"
    index={index}
  >
    {children}
  </SidebarEntrance>
);

const updateLabelFilter = (
  searchQuery: string,
  labelName: string,
  enabled: boolean
) => {
  const state = parseStructuredSearchQuery(searchQuery);
  const labelKey = normalizeLabelSelectionKey(labelName);
  const filters = state.filters.filter(
    (filter) =>
      filter.type !== "label" ||
      normalizeLabelSelectionKey(filter.value) !== labelKey
  );

  return serializeStructuredSearchState({
    ...state,
    filters: enabled
      ? [...filters, { type: "label", value: labelName }]
      : filters,
  });
};

const isNonemptyMailboxId = (
  mailboxId: string | null | undefined
): mailboxId is string => (mailboxId?.trim() ?? "") !== "";

export const SidebarLabelNav = ({
  animateEntrance,
  canManage,
  mailboxId,
  mailboxProvider,
  onManageLabels,
  onSearch,
  searchQuery,
}: SidebarLabelNavProps) => {
  const shouldAnimateEntrance = animateEntrance;
  const [hiddenLabelState, updateHiddenLabelState] = useReducer(
    reduceHiddenLabelState,
    mailboxId,
    createHiddenLabelState
  );
  const {
    data: labels,
    isError: areLabelsError,
    isPending: areLabelsPending,
  } = useQuery(
    labelsQueryOptions(mailboxId ?? "", isNonemptyMailboxId(mailboxId))
  );
  const labelsUnavailable = areLabelsError && labels === undefined;

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!isNonemptyMailboxId(mailboxId)) {
        return;
      }
      updateHiddenLabelState({
        mailboxId,
        updater: () => readHiddenLabelIds(mailboxId),
      });
    };
    window.addEventListener(
      SIDEBAR_LABEL_VISIBILITY_EVENT,
      handleVisibilityChange
    );
    return () => {
      window.removeEventListener(
        SIDEBAR_LABEL_VISIBILITY_EVENT,
        handleVisibilityChange
      );
    };
  }, [mailboxId]);

  const { data: managedLabelCounts = [] } = useQuery(
    managedLabelCountsQueryOptions(
      mailboxId ?? "",
      mailboxProvider === "managed" && isNonemptyMailboxId(mailboxId)
    )
  );
  const managedLabelCountById = new Map(
    managedLabelCounts.map((record) => [record.labelId, record.count])
  );
  const userLabels = getUserLabels(labels ?? []);
  const hiddenLabelIds =
    hiddenLabelState.mailboxId === mailboxId
      ? hiddenLabelState.value
      : readHiddenLabelIds(mailboxId);
  const effectiveHiddenLabelIds = computeEffectiveHiddenLabelIds(
    mailboxProvider,
    userLabels,
    hiddenLabelIds
  );
  const visibleUserLabels = userLabels.filter(
    (label) => !effectiveHiddenLabelIds.has(label.id)
  );
  const selectedLabelKeys = new Set(
    parseStructuredSearchQuery(searchQuery).filters.flatMap((filter) =>
      filter.type === "label" ? [normalizeLabelSelectionKey(filter.value)] : []
    )
  );
  const labelTitle = "Labels";
  const labelNounPlural = "labels";

  const renderLabelNavContent = (): ReactNode => {
    if (areLabelsPending) {
      return (
        <SidebarEntrance
          animateEntrance={shouldAnimateEntrance}
          className="px-2 py-1 text-caption text-muted-fg"
          index={9}
        >
          Loading {labelNounPlural}…
        </SidebarEntrance>
      );
    }
    if (labelsUnavailable) {
      return (
        <SidebarEntrance
          animateEntrance={shouldAnimateEntrance}
          className="px-2 py-1 text-caption text-destructive"
          index={9}
        >
          Could not load {labelNounPlural}.
        </SidebarEntrance>
      );
    }
    if (visibleUserLabels.length === 0) {
      return (
        <SidebarEntrance
          animateEntrance={shouldAnimateEntrance}
          className="px-2 py-1 text-caption text-muted-fg"
          index={9}
        >
          No {labelNounPlural} shown.
        </SidebarEntrance>
      );
    }
    return visibleUserLabels.map((label, index) => {
      const isActive =
        selectedLabelKeys.has(normalizeLabelSelectionKey(label.id)) ||
        selectedLabelKeys.has(normalizeLabelSelectionKey(label.name));

      return (
        <SidebarLabelEntrance
          key={label.id}
          animateEntrance={shouldAnimateEntrance}
          index={index + 9}
        >
          <SidebarNavItem
            active={isActive}
            aria-pressed={isActive}
            className={cn(
              "squircle h-7 w-full min-w-0 justify-start gap-2 rounded-md px-2.5 text-left text-caption font-normal",
              {
                "text-fg": isActive,
                "text-muted-fg": !isActive,
              }
            )}
            onClick={() => {
              onSearch(
                updateLabelFilter(
                  searchQuery,
                  selectedLabelKeys.has(normalizeLabelSelectionKey(label.id))
                    ? label.id
                    : label.name,
                  !isActive
                )
              );
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <ManagedLabelColorDot color={label.color} />
            <span className="min-w-0 truncate">{label.name}</span>
            {mailboxProvider === "managed" ? (
              <span className="ml-auto text-micro text-muted-fg tabular-nums">
                {managedLabelCountById.get(label.id) ?? 0}
              </span>
            ) : null}
          </SidebarNavItem>
        </SidebarLabelEntrance>
      );
    });
  };

  return (
    <section className="mt-4">
      <SidebarEntrance
        animateEntrance={shouldAnimateEntrance}
        className="mb-1 flex items-center justify-between px-2"
        index={8}
      >
        <p className="text-caption font-medium text-muted-fg">{labelTitle}</p>
        {canManage && (
          <IconButtonTooltip label={`Manage ${labelNounPlural}`}>
            <Button
              aria-label={`Manage ${labelNounPlural}`}
              className="size-6 text-muted-fg hover:text-fg"
              onClick={onManageLabels}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon
                aria-hidden
                className="size-3.5"
                icon={MoreVerticalIcon}
              />
            </Button>
          </IconButtonTooltip>
        )}
      </SidebarEntrance>

      <nav aria-label={labelTitle} className="flex flex-col">
        {renderLabelNavContent()}
      </nav>
    </section>
  );
};
