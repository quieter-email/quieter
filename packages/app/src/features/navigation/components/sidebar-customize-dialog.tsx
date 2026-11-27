"use client";

import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@quieter/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { SettingsCard } from "@quieter/ui/settings-layout";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { Text } from "@quieter/ui/text";

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

const ReorderControls = ({
  index,
  items,
  onMove,
}: {
  index: number;
  items: readonly SidebarEntry[];
  onMove: (id: string, offset: -1 | 1) => void;
}) => {
  const item = items[index];
  if (item === undefined || items.length < 2) {
    return null;
  }
  return (
    <div className="flex shrink-0 gap-1">
      {([-1, 1] as const).map((offset) => {
        const label = `Move ${item.label} ${offset === -1 ? "up" : "down"}`;
        return (
          <IconButtonTooltip key={offset} label={label}>
            <Button
              aria-label={label}
              disabled={index + offset < 0 || index + offset >= items.length}
              focusableWhenDisabled
              onClick={() => {
                onMove(item.id, offset);
              }}
              size="icon-sm"
              variant="ghost"
            >
              <Icon
                aria-hidden
                icon={offset === -1 ? ArrowUp01Icon : ArrowDown01Icon}
              />
            </Button>
          </IconButtonTooltip>
        );
      })}
    </div>
  );
};

export const SidebarCustomizeDialog = ({
  open,
  onOpenChange,
  sections,
  order,
  onMove,
  onReset,
  countEntries,
  onSetCounts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: readonly SidebarSection[];
  order: SidebarPreferences["order"];
  onMove: (
    key: string,
    items: readonly SidebarEntry[],
    id: string,
    offset: -1 | 1
  ) => void;
  onReset: (keys: ReadonlySet<string>) => void;
  countEntries: readonly string[];
  onSetCounts?: (ids: readonly string[], enabled: boolean) => void;
}) => {
  const orderedSections = orderSidebarEntries(
    sections,
    order[SIDEBAR_SECTIONS]
  );
  const resetKeys = new Set([
    SIDEBAR_SECTIONS,
    ...sections.flatMap(({ orderKey }) => orderKey ?? []),
  ]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col">
        <DialogHeader>
          <DialogTitle>Customize sidebar</DialogTitle>
          <DialogDescription>
            Use the arrows to move sections or items. Order is saved on this
            device.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="overflow-y-auto" spacing="3">
          {orderedSections.map((section, index) => {
            const { orderKey } = section;
            const countAction =
              section.id === SIDEBAR_MAIL ? onSetCounts : undefined;
            const items = orderSidebarEntries(
              section.items ?? [],
              orderKey === undefined ? undefined : order[orderKey]
            );
            return (
              <section key={section.id} aria-label={section.label}>
                <SettingsCard>
                  <div className="flex items-center gap-2 px-3 py-1">
                    <Text
                      className="min-w-0 flex-1"
                      size="sm"
                      truncate
                      weight="medium"
                    >
                      {section.label}
                    </Text>
                    {countAction !== undefined && (
                      <Text
                        className="min-w-9 text-center"
                        size="caption"
                        tone="muted"
                      >
                        Count
                      </Text>
                    )}
                    <ReorderControls
                      index={index}
                      items={orderedSections}
                      onMove={(id, offset) => {
                        onMove(SIDEBAR_SECTIONS, sections, id, offset);
                      }}
                    />
                  </div>
                  <ul>
                    {items.map((item, itemIndex) => (
                      <li
                        className="flex items-center gap-2 px-3 py-1"
                        key={item.id}
                      >
                        <Text
                          className="ms-3 min-w-0 flex-1"
                          size="sm"
                          tone="muted"
                          truncate
                        >
                          {item.label}
                        </Text>
                        {countAction !== undefined && (
                          <Switch
                            aria-label={`Show count for ${item.label}`}
                            checked={countEntries.includes(item.id)}
                            onCheckedChange={(enabled) => {
                              countAction([item.id], enabled);
                            }}
                            size="sm"
                          >
                            <SwitchThumb />
                          </Switch>
                        )}
                        {orderKey !== undefined && (
                          <ReorderControls
                            index={itemIndex}
                            items={items}
                            onMove={(id, offset) => {
                              onMove(orderKey, section.items ?? [], id, offset);
                            }}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </SettingsCard>
              </section>
            );
          })}
        </DialogBody>
        <DialogFooter>
          <Button
            disabled={Object.keys(order).every((key) => !resetKeys.has(key))}
            onClick={() => {
              onReset(resetKeys);
            }}
            variant="destructive"
          >
            Reset order
          </Button>
          <DialogCloseButton variant="default">Done</DialogCloseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
