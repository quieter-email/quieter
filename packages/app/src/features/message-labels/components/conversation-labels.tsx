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
  MailboxLabelColor,
} from "@quieter/mail/mailbox-organization";
import { Button } from "@quieter/ui/button";
import { ColorSwatch } from "@quieter/ui/color-swatch";
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
import { useQuery } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { createLabelGroupTree } from "../domain/label-group-tree";

export type ConversationLabelChanges = {
  addLabelIds: string[];
  removeLabelIds: string[];
};

type ConversationLabelsProps = {
  appliedLabelIds: readonly string[];
  labels: readonly MailboxLabel[];
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
  suggestionIds: [],
};

const LabelMarker = ({
  color,
  shape,
}: {
  color: MailboxLabelColor | null;
  shape: "circle" | "square";
}) => (
  <span className="flex size-4 items-center justify-center">
    <ColorSwatch
      color={
        color?.startsWith("#") === true ? color : `var(--q-${color ?? "gray"})`
      }
      shape={shape}
    />
  </span>
);

export const ConversationLabels = ({
  appliedLabelIds,
  labels,
  mailboxId,
  messageIds,
  onFilterByLabel,
  onUpdateLabels,
}: ConversationLabelsProps) => {
  const canEdit = onUpdateLabels !== undefined;
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState<PickerState>(closedPicker);
  const listId = useId();
  const [addButtonElement, setAddButtonElement] = useState<HTMLElement | null>(
    null
  );
  const rowRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restorePickerFocusRef = useRef(true);
  const removedLabelIdRef = useRef<string | null>(null);
  const { data: organization } = useQuery(
    labelOrganizationQueryOptions(mailboxId, canEdit)
  );
  const { data: suggestionIds } = useQuery(
    labelSuggestionsQueryOptions(mailboxId, messageIds, canEdit)
  );

  const applied = new Set(appliedLabelIds);
  // The pill a picker hangs off disappears when its label is unchecked; the
  // picker and later focus move to the add button for the rest of the session.
  if (picker.anchorLabelId !== null && !applied.has(picker.anchorLabelId)) {
    setPicker({ ...picker, anchorElement: null, anchorLabelId: null });
  }
  const appliedLabels = labels.filter(
    (label) => label.type === "user" && applied.has(label.id)
  );
  if (appliedLabels.length === 0 && !canEdit) {
    return null;
  }
  const anchor = picker.anchorElement ?? addButtonElement;

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

  const tree = createLabelGroupTree(picker.organization);
  const userLabelCount = picker.labels.filter(
    (label) => label.type === "user"
  ).length;
  const sections = buildLabelPickerSections(picker.labels, tree, {
    appliedIds: picker.appliedIds,
    groupId: picker.groupId,
    query: picker.query,
    suggestionIds: picker.suggestionIds,
  });
  const currentGroup =
    picker.groupId === null || picker.query.trim() !== ""
      ? undefined
      : tree.getGroup(picker.groupId);
  const items: PickerItem[] = [];
  if (currentGroup !== undefined) {
    const parent =
      currentGroup.parentId === null
        ? undefined
        : tree.getGroup(currentGroup.parentId);
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
              icon: <LabelMarker color={entry.group.color} shape="circle" />,
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
              icon: <LabelMarker color={entry.label.color} shape="square" />,
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
  if (items.length === 0) {
    status =
      userLabelCount === 0
        ? "No labels in this mailbox."
        : "No matching labels.";
  }

  const renderPill = (label: MailboxLabel): ReactNode => {
    const appearance = {
      className: "max-w-44 min-w-0",
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
        onClick={(event) => {
          togglePicker(label.id, event.currentTarget);
        }}
      >
        {name}
      </PillButton>
    ) : (
      <Pill {...appearance}>{name}</Pill>
    );
    if (onFilterByLabel === undefined && !canEdit) {
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
        <ContextMenuTrigger render={<span className="inline-flex min-w-0" />}>
          {pill}
        </ContextMenuTrigger>
        <ContextMenuContent
          finalFocus={() => {
            const removed = removedLabelIdRef.current === label.id;
            removedLabelIdRef.current = null;
            return removed ? addButtonElement : true;
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

  const addButtonProps = {
    "aria-expanded": open && picker.anchorLabelId === null,
    "aria-haspopup": "dialog",
    onClick: () => {
      togglePicker(null, null);
    },
    ref: setAddButtonElement,
    variant: "ghost",
  } as const;
  const hasLabels = appliedLabels.length > 0;
  const addButton = canEdit ? (
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

  return (
    <div
      aria-label="Conversation labels"
      className="flex min-w-0 flex-wrap items-center gap-1"
      ref={rowRef}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- A fieldset would imply form controls; this groups label chips.
      role="group"
    >
      {appliedLabels.map(renderPill)}
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
              rowRef.current?.contains(target) === true
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
            finalFocus={(closeType) =>
              restorePickerFocusRef.current &&
              (closeType === "keyboard" || closeType === "")
                ? anchor
                : false
            }
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
