"use client";

import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers";
import { Cursor } from "@dnd-kit/dom";
import { DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { Cancel01Icon, GripVerticalIcon } from "@hugeicons/core-free-icons";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { ColorSwatch } from "@quieter/ui/color-swatch";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { SettingsCard } from "@quieter/ui/settings-layout";
import { Text } from "@quieter/ui/text";
import { useRef } from "react";
import type { ReactNode } from "react";

import {
  SIDEBAR_MAIL,
  SIDEBAR_SECTIONS,
  orderSidebarEntries,
} from "../domain/sidebar-preferences";
import type {
  SidebarEntry,
  SidebarPreferences,
  SidebarSection,
} from "../domain/sidebar-preferences";

type SidebarDragData = { group: string; id: string; ids: readonly string[] };
type SidebarMove = SidebarDragData & { targetId: string };

const verticalAxis = [RestrictToVerticalAxis];

const SidebarSortEntry = ({
  entry,
  group,
  ids,
  index,
  children,
  trailing,
}: {
  entry: SidebarEntry;
  group: string;
  ids: readonly string[];
  index: number;
  children?: ReactNode;
  trailing?: ReactNode;
}) => {
  const section = group === SIDEBAR_SECTIONS;
  const enabled = ids.length > 1;
  const { handleRef, ref, targetRef } = useSortable<SidebarDragData>({
    accept: group,
    data: { group, id: entry.id, ids },
    disabled: !enabled,
    group,
    id: JSON.stringify([group, entry.id]),
    index,
    modifiers: verticalAxis,
    type: group,
  });

  return (
    <div
      className={cn({ "space-y-1.5": section })}
      ref={enabled ? ref : undefined}
    >
      <div
        className={cn("flex min-w-0 items-center gap-2", {
          "px-2 py-1.25": !section,
        })}
        ref={enabled && section ? targetRef : undefined}
      >
        {enabled ? (
          <IconButtonTooltip label={`Reorder ${entry.label}`}>
            <Button
              aria-label={`Reorder ${entry.label}`}
              className="shrink-0 touch-none"
              ref={handleRef}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <Icon aria-hidden icon={GripVerticalIcon} tone="muted" />
            </Button>
          </IconButtonTooltip>
        ) : (
          <div aria-hidden className="size-6 shrink-0" />
        )}
        {entry.icon !== undefined && (
          <Icon aria-hidden icon={entry.icon} tone="muted" />
        )}
        {entry.color !== undefined && (
          <ColorSwatch
            color={
              entry.color?.startsWith("#") === true
                ? entry.color
                : `var(--q-${entry.color ?? "gray"})`
            }
          />
        )}
        <Text
          as={section ? "h3" : "span"}
          className="min-w-0 flex-1"
          size="sm"
          truncate
          weight={section ? "medium" : "normal"}
        >
          {entry.label}
        </Text>
        {trailing}
      </div>
      {children}
    </div>
  );
};

const folderCountOptions = [
  { label: "Show count", value: "show" },
  { label: "Hide count", value: "hide" },
];

const allCountOptions = [
  { label: "Show all counts", value: "show" },
  { label: "Hide all counts", value: "hide" },
];

const SidebarCountSelect = ({
  label,
  value,
  onChange,
  bulk = false,
}: {
  label: string;
  value: "show" | "hide" | "mixed";
  onChange: (enabled: boolean) => void;
  bulk?: boolean;
}) => {
  const options = bulk ? allCountOptions : folderCountOptions;
  return (
    <Select
      items={options}
      onValueChange={(next) => {
        if (next === "show" || next === "hide") {
          onChange(next === "show");
        }
      }}
      value={value}
    >
      <SelectTrigger aria-label={label} size="sm" variant="ghost">
        <SelectValue>
          {value === "mixed" ? "Per folder" : undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end" size="compact">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export const SidebarCustomizeDialog = ({
  open,
  onOpenChange,
  sections,
  order,
  onMove,
  countEntries,
  onSetCounts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: readonly SidebarSection[];
  order: SidebarPreferences["order"];
  onMove: (move: SidebarMove) => void;
  countEntries: readonly string[];
  onSetCounts?: (ids: readonly string[], enabled: boolean) => void;
}) => {
  const dragState = useRef<{ active: boolean; cancelEvent?: Event }>({
    active: false,
  });
  const orderedSections = orderSidebarEntries(
    sections,
    order[SIDEBAR_SECTIONS]
  );
  const sectionIds = orderedSections.map((section) => section.id);
  const mailIds =
    sections
      .find((section) => section.id === SIDEBAR_MAIL)
      ?.items?.map((item) => item.id) ?? [];
  const enabledCount = mailIds.filter((id) => countEntries.includes(id)).length;
  let mailCounts: "show" | "hide" | "mixed" = "mixed";
  if (enabledCount === 0) {
    mailCounts = "hide";
  } else if (enabledCount === mailIds.length) {
    mailCounts = "show";
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (
          !next &&
          details.reason === "escape-key" &&
          (dragState.current.active ||
            dragState.current.cancelEvent === details.event)
        ) {
          details.cancel();
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[85dvh] flex-col">
        <DialogHeader className="mx-1 mt-1">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>Customize sidebar</DialogTitle>
            <IconButtonTooltip label="Close">
              <DialogClose aria-label="Close">
                <Icon aria-hidden icon={Cancel01Icon} />
              </DialogClose>
            </IconButtonTooltip>
          </div>
        </DialogHeader>
        <DialogBody className="mx-1 mb-1 overflow-y-auto" spacing="4">
          {onSetCounts !== undefined && mailIds.length > 0 && (
            <SettingsCard>
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <Text size="sm" weight="medium">
                  Mail counts
                </Text>
                <SidebarCountSelect
                  bulk
                  label="Mail counts"
                  onChange={(enabled) => {
                    onSetCounts(mailIds, enabled);
                  }}
                  value={mailCounts}
                />
              </div>
            </SettingsCard>
          )}
          <DragDropProvider<SidebarDragData>
            plugins={(defaults) =>
              defaults.filter((plugin) => plugin !== Cursor)
            }
            onDragStart={() => {
              dragState.current = { active: true };
            }}
            onDragEnd={(event) => {
              dragState.current = {
                active: false,
                cancelEvent: event.canceled ? event.nativeEvent : undefined,
              };
              const { source } = event.operation;
              if (event.canceled || !isSortable(source)) {
                return;
              }
              const { ids, id, group } = source.data;
              const targetId = ids[source.index];
              if (targetId !== undefined && targetId !== id) {
                onMove({ group, id, ids, targetId });
              }
            }}
          >
            <div className="space-y-4">
              {orderedSections.map((section, index) => {
                const { orderKey } = section;
                const items = orderSidebarEntries(
                  section.items ?? [],
                  orderKey === undefined ? undefined : order[orderKey]
                );
                const ids = items.map((item) => item.id);
                return (
                  <SidebarSortEntry
                    key={section.id}
                    entry={section}
                    group={SIDEBAR_SECTIONS}
                    ids={sectionIds}
                    index={index}
                  >
                    {orderKey !== undefined && items.length > 0 && (
                      <SettingsCard>
                        {items.map((item, itemIndex) => (
                          <SidebarSortEntry
                            key={item.id}
                            entry={item}
                            group={orderKey}
                            ids={ids}
                            index={itemIndex}
                            trailing={
                              section.id === SIDEBAR_MAIL &&
                              onSetCounts !== undefined && (
                                <SidebarCountSelect
                                  label={`Count for ${item.label}`}
                                  onChange={(enabled) => {
                                    onSetCounts([item.id], enabled);
                                  }}
                                  value={
                                    countEntries.includes(item.id)
                                      ? "show"
                                      : "hide"
                                  }
                                />
                              )
                            }
                          />
                        ))}
                      </SettingsCard>
                    )}
                  </SidebarSortEntry>
                );
              })}
            </div>
          </DragDropProvider>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
};
