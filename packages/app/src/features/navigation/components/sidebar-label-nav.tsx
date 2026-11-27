"use client";

import { MoreVerticalIcon } from "@hugeicons/core-free-icons";
import { applyMailboxSearchPatch } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import type { MailboxSearchPatch } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import { MailboxLabelSwatch } from "@quieter/app/features/message-labels/components/mailbox-label-swatch";
import {
  SIDEBAR_LABEL_VISIBILITY_EVENT,
  computeEffectiveHiddenLabelIds,
  createHiddenLabelState,
  readHiddenLabelIds,
  reduceHiddenLabelState,
} from "@quieter/app/features/message-labels/domain/sidebar-label-visibility";
import { serializeStructuredSearchState } from "@quieter/app/features/message-search/components/message-list-search/message-list-search-utils";
import {
  getUserLabels,
  normalizeLabelSelectionKey,
  parseStructuredSearchQuery,
} from "@quieter/app/features/message-search/state/message-list-search-state";
import { SidebarMailboxNavItem } from "@quieter/app/features/navigation/components/sidebar-nav-item";
import { SidebarEntrance } from "@quieter/app/features/navigation/components/sidebar-surfaces";
import type { MailboxCategory } from "@quieter/app/lib/mail";
import { labelsQueryOptions } from "@quieter/app/lib/mail/labels-query";
import { managedLabelCountsQueryOptions } from "@quieter/app/lib/managed-mailbox-organization-query";
import { mailboxSearchSchema } from "@quieter/app/route-search";
import { Button } from "@quieter/ui/button";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useSelector } from "@tanstack/react-store";
import type { ReactNode } from "react";
import { useEffect, useEffectEvent, useReducer, useState } from "react";

import { getLabelUpdates } from "../../message-labels/components/label-update-mutation";
import { orderSidebarEntries } from "../domain/sidebar-preferences";
import type { SidebarEntry } from "../domain/sidebar-preferences";
import { SidebarContextMenu } from "./sidebar-context-menu";
import {
  SidebarLabelDialogs,
  useSidebarLabelFilterReplacement,
  useSidebarSearchNavigation,
} from "./sidebar-label-actions";
import type { SidebarLabelDialogState } from "./sidebar-label-actions";

type SidebarLabelNavProps = {
  animateEntrance: boolean;
  canManage: boolean;
  embedded: boolean;
  mailboxId: string | null;
  mailboxProvider: "gmail" | "managed";
  onItemsChange?: (items: readonly SidebarEntry[]) => void;
  onManageLabels: () => void;
  onRequestClose?: () => void;
  onSearch: (query: string) => void;
  order?: readonly string[];
  searchQuery: string;
  selectedMailbox: MailboxCategory | null;
};

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
  embedded,
  mailboxId,
  mailboxProvider,
  onItemsChange,
  onManageLabels,
  onRequestClose,
  onSearch,
  order,
  searchQuery,
  selectedMailbox,
}: SidebarLabelNavProps) => {
  const shouldAnimateEntrance = animateEntrance;
  const queryClient = useQueryClient();
  const navigateSearch = useSidebarSearchNavigation();
  const replaceLabelFilters = useSidebarLabelFilterReplacement();
  const [labelDialog, setLabelDialog] =
    useState<SidebarLabelDialogState | null>(null);
  if (
    labelDialog !== null &&
    (!canManage || labelDialog.request.mailboxId !== mailboxId)
  ) {
    setLabelDialog(null);
  }
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
  const labelUpdates = getLabelUpdates({
    mailboxId: mailboxId ?? "",
    mailboxProvider,
    queryClient,
  });
  const labelUpdateState = useSelector(labelUpdates.state);
  const userLabels = getUserLabels(
    labelUpdates.project(labels ?? [], labelUpdateState)
  );
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
  const showsLabelRows =
    !areLabelsPending && !labelsUnavailable && visibleUserLabels.length > 0;
  const navItems = showsLabelRows
    ? visibleUserLabels.map((label) => ({
        color: label.color,
        id: label.id,
        label: label.name,
      }))
    : [];
  const manageLabelsPatch: MailboxSearchPatch = {
    mailbox: "inbox",
    mailboxId,
    messageId: null,
    query: null,
    view: "labels",
    workspace: null,
  };
  const openManageLabels = () => {
    if (embedded) {
      onManageLabels();
    }
    onRequestClose?.();
  };

  const navItemsKey = JSON.stringify(navItems);
  const reportNavItems = useEffectEvent(() => {
    onItemsChange?.(navItems);
  });
  useEffect(() => {
    reportNavItems();
  }, [navItemsKey, onItemsChange]);

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
    return orderSidebarEntries(visibleUserLabels, order).map((label, index) => {
      const isActive =
        selectedMailbox !== null &&
        (selectedLabelKeys.has(normalizeLabelSelectionKey(label.id)) ||
          selectedLabelKeys.has(normalizeLabelSelectionKey(label.name)));
      const nextQuery = updateLabelFilter(
        searchQuery,
        selectedLabelKeys.has(normalizeLabelSelectionKey(label.id))
          ? label.id
          : label.name,
        !isActive
      );
      const labelOnlyQuery = serializeStructuredSearchState({
        filters: [{ type: "label", value: label.name }],
        text: "",
      });

      return (
        <SidebarLabelEntrance
          key={label.id}
          animateEntrance={shouldAnimateEntrance}
          index={index + 9}
        >
          <SidebarContextMenu
            actions={[
              {
                label: "Search in label",
                onSelect: () => {
                  if (embedded) {
                    onSearch(labelOnlyQuery);
                  } else {
                    navigateSearch({
                      mailbox: selectedMailbox ?? "inbox",
                      mailboxId,
                      messageId: null,
                      query: labelOnlyQuery,
                      view: "inbox",
                      workspace: null,
                    });
                  }
                  onRequestClose?.();
                },
              },
              ...(canManage && isNonemptyMailboxId(mailboxId)
                ? [
                    {
                      label: "Edit label",
                      onSelect: () => {
                        setLabelDialog({
                          open: true,
                          request: {
                            kind: "edit",
                            label,
                            mailboxId,
                            mailboxProvider,
                          },
                        });
                      },
                    },
                    {
                      label: "Delete label",
                      onSelect: () => {
                        setLabelDialog({
                          open: true,
                          request: {
                            kind: "delete",
                            label,
                            mailboxId,
                            mailboxProvider,
                          },
                        });
                      },
                      tone: "destructive" as const,
                    },
                  ]
                : []),
            ]}
          >
            <SidebarMailboxNavItem
              active={isActive}
              aria-current={isActive ? "page" : undefined}
              className="min-w-0"
              mailboxSearch={
                embedded
                  ? undefined
                  : {
                      mailbox: selectedMailbox ?? "inbox",
                      mailboxId,
                      messageId: null,
                      query: nextQuery,
                      view: "inbox",
                      workspace: null,
                    }
              }
              onClick={() => {
                if (embedded) {
                  onSearch(nextQuery);
                }
                onRequestClose?.();
              }}
              type="button"
              variant="ghost"
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center">
                <MailboxLabelSwatch color={label.color} />
              </span>
              <span className="min-w-0 truncate">{label.name}</span>
              {mailboxProvider === "managed" ? (
                <span className="ml-auto text-micro text-muted-fg tabular-nums">
                  {managedLabelCountById.get(label.id) ?? 0}
                </span>
              ) : null}
            </SidebarMailboxNavItem>
          </SidebarContextMenu>
        </SidebarLabelEntrance>
      );
    });
  };

  return (
    <section className="mt-4">
      <SidebarEntrance
        animateEntrance={shouldAnimateEntrance}
        className="mb-1"
        index={8}
      >
        <SidebarContextMenu
          actions={
            canManage
              ? [
                  {
                    label: `Manage ${labelNounPlural}`,
                    onSelect: () => {
                      if (!embedded) {
                        navigateSearch(manageLabelsPatch);
                      }
                      openManageLabels();
                    },
                  },
                ]
              : []
          }
        >
          <div className="flex items-center justify-between px-3">
            <p className="text-caption font-medium text-muted-fg">
              {labelTitle}
            </p>
            {canManage && (
              <IconButtonTooltip label={`Manage ${labelNounPlural}`}>
                <Button
                  aria-label={`Manage ${labelNounPlural}`}
                  nativeButton={embedded}
                  onClick={openManageLabels}
                  render={
                    embedded ? undefined : (
                      <Link
                        replace
                        resetScroll={false}
                        search={(previous) =>
                          applyMailboxSearchPatch(
                            mailboxSearchSchema.parse(previous),
                            manageLabelsPatch
                          )
                        }
                        to="/"
                      />
                    )
                  }
                  className="-me-1.25"
                  role={embedded ? "button" : "link"}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <Icon aria-hidden size={14} icon={MoreVerticalIcon} />
                </Button>
              </IconButtonTooltip>
            )}
          </div>
        </SidebarContextMenu>
      </SidebarEntrance>

      <nav aria-label={labelTitle} className="flex flex-col">
        {renderLabelNavContent()}
      </nav>
      <SidebarLabelDialogs
        onDeleted={(request) => {
          if (selectedMailbox === null) {
            return;
          }
          replaceLabelFilters({
            inScope: (route) =>
              route.view !== "all-inboxes" &&
              (route.mailboxId ?? mailboxId) === request.mailboxId,
            nextName: null,
            previousNames: [request.label.id, request.label.name],
          });
        }}
        onOpenChange={(open) => {
          setLabelDialog((current) => current && { ...current, open });
        }}
        onRenamed={(request, label) => {
          replaceLabelFilters({
            inScope: (route) =>
              route.view !== "all-inboxes" &&
              (route.mailboxId ?? mailboxId) === request.mailboxId,
            nextName: label.name,
            previousNames: [request.label.name],
          });
        }}
        state={labelDialog}
      />
    </section>
  );
};
