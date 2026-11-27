"use client";

import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  FilterHorizontalIcon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { buildLabelPickerSections } from "@quieter/app/features/message-labels/domain/conversation-label-picker";
import { mailboxLabelPillToneByColor } from "@quieter/app/features/message-labels/domain/mailbox-label-presentation";
import { toastError } from "@quieter/app/lib/error-toast";
import { labelOrganizationQueryOptions } from "@quieter/app/lib/mail/label-organization-query";
import { labelSuggestionsQueryOptions } from "@quieter/app/lib/mail/label-suggestions-query";
import type {
  LabelOrganization,
  MailboxLabel,
} from "@quieter/mail/mailbox-organization";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { CommandMenu } from "@quieter/ui/command-menu";
import type { CommandMenuItem } from "@quieter/ui/command-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@quieter/ui/context-menu";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { Pill, PillButton } from "@quieter/ui/pill";
import { Popover, PopoverContent, PopoverTitle } from "@quieter/ui/popover";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { createLabelGroupTree } from "../domain/label-group-tree";
import { MailboxLabelSwatch } from "./mailbox-label-swatch";

export type ConversationLabelChanges = {
  addLabelIds: string[];
  removeLabelIds: string[];
};

type ConversationLabelsProps = {
  appliedLabelIds: readonly string[];
  labels: readonly MailboxLabel[];
  layout?: "header" | "stacked" | "adaptive";
  mailboxId: string;
  messageIds: readonly string[];
  onFilterByLabel?: (label: MailboxLabel) => void;
  /** Omitted when the mailbox does not let this user change labels. */
  onUpdateLabels?: (changes: ConversationLabelChanges) => Promise<void> | void;
};

/** `anchorLabelId` is null when the picker hangs off the add button. */
type PickerState = {
  anchorElement: HTMLElement | null;
  anchorLabelId: string | null;
  appliedIds: readonly string[];
  groupId: string | null;
  highlightedId: string | null;
  labels: readonly MailboxLabel[];
  organization?: LabelOrganization;
  query: string;
  ready: boolean;
  suggestionIds: readonly string[];
};

type PickerAction =
  | { kind: "back"; groupId: string | null }
  | { kind: "group"; groupId: string }
  | { kind: "label"; labelId: string };

type PickerItem = CommandMenuItem & { action: PickerAction };

const closedPicker: PickerState = {
  anchorElement: null,
  anchorLabelId: null,
  appliedIds: [],
  groupId: null,
  highlightedId: null,
  labels: [],
  query: "",
  ready: false,
  suggestionIds: [],
};

export const ConversationLabels = ({
  appliedLabelIds,
  labels,
  layout = "header",
  mailboxId,
  messageIds,
  onFilterByLabel,
  onUpdateLabels,
}: ConversationLabelsProps) => {
  const canEdit = onUpdateLabels !== undefined;
  const isRow = layout !== "header";
  const pillSize = layout === "adaptive" ? "adaptive" : "sm";
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState<PickerState>(closedPicker);
  const listId = useId();
  const [addButtonElement, setAddButtonElement] = useState<HTMLElement | null>(
    null
  );
  const [rowElement, setRowElement] = useState<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  const restorePickerFocusRef = useRef(true);
  const removedLabelIdRef = useRef<string | null>(null);
  const shouldLoadDetails = canEdit && (!isRow || open);
  const organizationQuery = useQueries<
    ReturnType<typeof labelOrganizationQueryOptions>[]
  >({
    queries: shouldLoadDetails
      ? [labelOrganizationQueryOptions(mailboxId)]
      : [],
  }).at(0);
  const suggestionsQuery = useQueries<
    ReturnType<typeof labelSuggestionsQueryOptions>[]
  >({
    queries: shouldLoadDetails
      ? [labelSuggestionsQueryOptions(mailboxId, messageIds)]
      : [],
  }).at(0);
  const organization = organizationQuery?.data;
  const suggestionIds = suggestionsQuery?.data;
  const isWaitingForDetails =
    organizationQuery?.isPending === true ||
    (messageIds.length > 0 && suggestionsQuery?.isPending === true);
  if (open && !picker.ready && !isWaitingForDetails) {
    setPicker({
      ...picker,
      organization,
      ready: true,
      suggestionIds: suggestionIds ?? [],
    });
  }
  useEffect((): (() => void) | undefined => {
    if (!isRow || !open) {
      return undefined;
    }
    const row = rowElement?.closest("li");
    const viewport = row?.closest<HTMLElement>("[data-message-list-viewport]");
    if (!row || !viewport) {
      return undefined;
    }
    viewportRef.current = viewport;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.at(0)?.isIntersecting !== false) {
          return;
        }
        if (
          inputRef.current
            ?.closest("[data-popover-popup]")
            ?.contains(document.activeElement) === true
        ) {
          viewport.focus({ preventScroll: true });
        }
        restorePickerFocusRef.current = false;
        setOpen(false);
      },
      { root: viewport }
    );
    observer.observe(row);
    return () => {
      observer.disconnect();
    };
  }, [isRow, open, rowElement]);

  const applied = new Set(appliedLabelIds);
  const appliedLabels = labels.filter(
    (label) => label.type === "user" && applied.has(label.id)
  );
  if (appliedLabels.length === 0 && (!canEdit || (isRow && !open))) {
    return null;
  }
  const visibleLabels = isRow
    ? appliedLabels.slice(0, layout === "adaptive" ? 4 : 2)
    : appliedLabels;
  if (
    picker.anchorLabelId !== null &&
    !visibleLabels.some(({ id }) => id === picker.anchorLabelId)
  ) {
    setPicker({ ...picker, anchorElement: null, anchorLabelId: null });
  }
  const hiddenLabels = appliedLabels.slice(visibleLabels.length);
  const hiddenCount = hiddenLabels.length;
  const anchor = picker.anchorElement ?? addButtonElement ?? rowElement;
  const returnFocus = () =>
    (addButtonElement?.isConnected === true ? addButtonElement : null) ??
    rowElement
      ?.closest("li")
      ?.querySelector<HTMLElement>("[data-message-row-trigger]") ??
    (viewportRef.current?.isConnected === true ? viewportRef.current : null) ??
    false;

  const togglePicker = (
    anchorLabelId: string | null,
    anchorElement: HTMLElement | null
  ) => {
    if (open) {
      if (picker.anchorLabelId === anchorLabelId) {
        setOpen(false);
      } else {
        setPicker({ ...picker, anchorElement, anchorLabelId });
      }
      return;
    }
    setPicker({
      ...closedPicker,
      anchorElement,
      anchorLabelId,
      appliedIds: appliedLabels.map((label) => label.id),
      labels,
      organization,
      ready:
        organization !== undefined &&
        (suggestionIds !== undefined || messageIds.length === 0),
      suggestionIds: suggestionIds ?? [],
    });
    restorePickerFocusRef.current = true;
    setOpen(true);
  };

  const updateLabels = async (changes: ConversationLabelChanges) => {
    try {
      await onUpdateLabels?.(changes);
    } catch (error) {
      toastError(error, {
        boundary: "label-actions",
        fallback: "Could not update labels.",
      });
    }
  };

  const tree =
    open && picker.ready
      ? createLabelGroupTree(picker.organization)
      : undefined;
  const userLabelCount = picker.labels.filter(
    (label) => label.type === "user"
  ).length;
  const sections =
    tree === undefined
      ? []
      : buildLabelPickerSections(picker.labels, tree, {
          appliedIds: picker.appliedIds,
          groupId: picker.groupId,
          query: picker.query,
          suggestionIds: picker.suggestionIds,
        });
  const currentGroup =
    picker.groupId === null || picker.query.trim() !== ""
      ? undefined
      : tree?.getGroup(picker.groupId);
  const items: PickerItem[] = [];
  if (currentGroup !== undefined) {
    const parent =
      currentGroup.parentId === null
        ? undefined
        : tree?.getGroup(currentGroup.parentId);
    items.push({
      action: { groupId: parent?.id ?? null, kind: "back" },
      group: sections[0]?.title ?? currentGroup.name,
      icon: <Icon icon={ArrowLeft01Icon} tone="muted" />,
      id: "back",
      label: parent?.name ?? "All labels",
    });
  }
  for (const section of sections) {
    for (const entry of section.entries) {
      items.push(
        entry.kind === "group"
          ? {
              action: { groupId: entry.group.id, kind: "group" },
              group: section.title,
              icon: (
                <MailboxLabelSwatch color={entry.group.color} kind="group" />
              ),
              id: `group:${entry.group.id}`,
              label: entry.group.name,
              shortcut: (
                <span className="flex shrink-0 items-center gap-1 text-caption text-muted-fg tabular-nums">
                  {entry.labelCount}
                  <Icon aria-hidden icon={ArrowRight01Icon} size={14} />
                </span>
              ),
            }
          : {
              action: { kind: "label", labelId: entry.label.id },
              checked: applied.has(entry.label.id),
              description:
                currentGroup === undefined
                  ? (entry.path ?? undefined)
                  : undefined,
              group: section.title,
              icon: <MailboxLabelSwatch color={entry.label.color} />,
              id: `label:${entry.label.id}`,
              label: entry.label.name,
            }
      );
    }
  }
  const highlightedIndex = items.findIndex(
    ({ id }) => id === picker.highlightedId
  );
  const activeIndex = Math.max(
    0,
    highlightedIndex === -1
      ? items.findIndex(({ id }) => id !== "back")
      : highlightedIndex
  );

  const highlight = (index: number) => {
    const highlightedId = items[index]?.id ?? null;
    setPicker((current) =>
      current.highlightedId === highlightedId
        ? current
        : { ...current, highlightedId }
    );
    document
      .querySelector(`#${CSS.escape(`${listId}-${index}`)}`)
      ?.scrollIntoView({ block: "nearest" });
  };

  const activate = (index: number) => {
    const action = items[index]?.action;
    if (action === undefined) {
      return;
    }
    if (action.kind === "label") {
      const checked = !applied.has(action.labelId);
      void updateLabels({
        addLabelIds: checked ? [action.labelId] : [],
        removeLabelIds: checked ? [] : [action.labelId],
      });
      return;
    }
    setPicker((current) => ({
      ...current,
      groupId: action.groupId,
      highlightedId:
        action.kind === "back" && current.groupId !== null
          ? `group:${current.groupId}`
          : null,
      query: "",
    }));
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Safari can clear isComposing before the IME confirmation key event.
    // oxlint-disable-next-line typescript/no-deprecated
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const activeItem = items[activeIndex];
    if (event.key === "Enter") {
      event.preventDefault();
      activate(activeIndex);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length > 0) {
        highlight(
          (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length
        );
      }
    } else if (
      event.key === "ArrowRight" &&
      picker.query === "" &&
      activeItem?.action.kind === "group"
    ) {
      event.preventDefault();
      activate(activeIndex);
    } else if (
      (event.key === "ArrowLeft" || event.key === "Backspace") &&
      picker.query === "" &&
      currentGroup !== undefined
    ) {
      event.preventDefault();
      activate(items.findIndex(({ id }) => id === "back"));
    }
  };

  let status: string | undefined;
  if (!picker.ready) {
    status =
      organizationQuery?.isPaused === true ||
      suggestionsQuery?.isPaused === true
        ? "Waiting for a connection…"
        : "Loading labels…";
  } else if (items.length === 0) {
    status =
      userLabelCount === 0
        ? "No labels in this mailbox."
        : "No matching labels.";
  }

  const renderPill = (label: MailboxLabel): ReactNode => {
    const appearance = {
      className: cn("min-w-0", {
        "@3xl:max-w-36": layout === "adaptive",
        "max-w-24 shrink": isRow,
        "max-w-44": !isRow,
      }),
      customColor:
        label.color?.startsWith("#") === true ? label.color : undefined,
      title: label.name,
      tone: mailboxLabelPillToneByColor[label.color ?? "gray"],
    };
    const name = <span className="truncate">{label.name}</span>;
    const pill = canEdit ? (
      <PillButton
        {...appearance}
        aria-expanded={open && picker.anchorLabelId === label.id}
        aria-haspopup="dialog"
        size={pillSize}
        onClick={(event) => {
          togglePicker(label.id, event.currentTarget);
        }}
      >
        {name}
      </PillButton>
    ) : (
      <Pill {...appearance} size={pillSize}>
        {name}
      </Pill>
    );
    if (!canEdit && (isRow || onFilterByLabel === undefined)) {
      return <span key={label.id}>{pill}</span>;
    }

    return (
      <ContextMenu
        key={label.id}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            restorePickerFocusRef.current = false;
            setOpen(false);
          }
        }}
      >
        <ContextMenuTrigger
          render={<span className="pointer-events-auto inline-flex min-w-0" />}
        >
          {pill}
        </ContextMenuTrigger>
        <ContextMenuContent
          finalFocus={() => {
            const removed = removedLabelIdRef.current === label.id;
            removedLabelIdRef.current = null;
            return removed ? returnFocus() : true;
          }}
        >
          {onFilterByLabel === undefined ? null : (
            <ContextMenuItem
              onSelect={() => {
                onFilterByLabel(label);
              }}
            >
              <Icon aria-hidden icon={FilterHorizontalIcon} />
              <span>Filter by label</span>
            </ContextMenuItem>
          )}
          {canEdit ? (
            <ContextMenuItem
              onSelect={() => {
                removedLabelIdRef.current = label.id;
                void updateLabels({
                  addLabelIds: [],
                  removeLabelIds: [label.id],
                });
              }}
            >
              <Icon aria-hidden icon={Cancel01Icon} />
              <span>Remove label</span>
            </ContextMenuItem>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const handleOverflowClick = () => {
    togglePicker(null, null);
  };
  const addButtonProps = {
    "aria-expanded": open && picker.anchorLabelId === null,
    "aria-haspopup": "dialog",
    onClick: handleOverflowClick,
    ref: setAddButtonElement,
    variant: "ghost",
  } as const;
  const hasLabels = appliedLabels.length > 0;
  const addButton =
    canEdit && !isRow ? (
      <IconButtonTooltip label="Add labels">
        <Button
          {...addButtonProps}
          aria-label="Add labels"
          size={hasLabels ? "icon-xs" : "xs"}
        >
          <Icon aria-hidden icon={PlusSignIcon} />
          {hasLabels ? null : "Add labels"}
        </Button>
      </IconButtonTooltip>
    ) : null;
  let overflow: ReactNode = null;
  if (hiddenCount > 0) {
    const hiddenNames = hiddenLabels.map(({ name }) => name).join(", ");
    overflow = canEdit ? (
      <PillButton
        aria-expanded={addButtonProps["aria-expanded"]}
        aria-haspopup="dialog"
        aria-label={`Show ${hiddenCount} more labels`}
        className="pointer-events-auto"
        onClick={handleOverflowClick}
        ref={setAddButtonElement}
        size={pillSize}
        title={hiddenNames}
      >
        +{hiddenCount}
      </PillButton>
    ) : (
      <Pill
        aria-label={`More labels, ${hiddenNames}`}
        size={pillSize}
        title={hiddenNames}
      >
        +{hiddenCount}
      </Pill>
    );
  }

  return (
    <div
      aria-label="Conversation labels"
      className={cn("min-w-0 items-center gap-1", {
        "flex flex-wrap": !isRow,
        "hidden @sm:flex": isRow,
      })}
      ref={setRowElement}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- A fieldset would imply form controls; this groups label chips.
      role="group"
    >
      {visibleLabels.map(renderPill)}
      {overflow}
      {addButton}
      {canEdit ? (
        <Popover
          onOpenChange={(nextOpen, details) => {
            const target = details.event?.target;
            // Pills and the add button toggle or move the picker themselves.
            if (
              !nextOpen &&
              details.reason === "outside-press" &&
              target instanceof Element &&
              target.closest("button") !== null &&
              rowElement?.contains(target) === true
            ) {
              return;
            }
            setOpen(nextOpen);
          }}
          open={open}
        >
          <PopoverContent
            align="start"
            anchor={anchor}
            chrome="bare"
            collisionPadding={16}
            finalFocus={(closeType) => {
              if (
                !restorePickerFocusRef.current ||
                (closeType !== "keyboard" && closeType !== "")
              ) {
                return false;
              }
              return picker.anchorElement?.isConnected === true
                ? picker.anchorElement
                : returnFocus();
            }}
            initialFocus={inputRef}
          >
            <PopoverTitle className="sr-only">Labels</PopoverTitle>
            <CommandMenu
              activeIndex={activeIndex}
              id={listId}
              items={items}
              label="Labels"
              onHighlight={highlight}
              onSelect={activate}
              search={
                <Input
                  aria-activedescendant={
                    items.length > 0 ? `${listId}-${activeIndex}` : undefined
                  }
                  aria-autocomplete="list"
                  aria-controls={listId}
                  aria-expanded={open}
                  aria-label="Search labels"
                  autoComplete="off"
                  chrome="command"
                  onChange={(event) => {
                    const { value } = event.target;
                    setPicker((current) => ({
                      ...current,
                      highlightedId: null,
                      query: value,
                    }));
                  }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search labels…"
                  ref={inputRef}
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Input renders an input with an external label listbox.
                  role="combobox"
                  size="sm"
                  value={picker.query}
                />
              }
              selectionHint={false}
              status={status}
            />
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
};
