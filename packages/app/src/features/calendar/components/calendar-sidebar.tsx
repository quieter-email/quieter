"use client";

import {
  Add01Icon,
  ArrowLeft01Icon,
  Cancel01Icon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { SidebarFooterLinks } from "@quieter/app/features/navigation/components/sidebar-footer-links";
import type { CalendarAccount, CalendarSummary } from "@quieter/calendar";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { Calendar } from "@quieter/ui/calendar";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { ColorPicker } from "@quieter/ui/color-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Pill } from "@quieter/ui/pill";
import { WorkspaceSidebar } from "@quieter/ui/workspace-sidebar";
import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import type { ComponentProps, ReactNode } from "react";

import { getCalendarRefKey } from "../domain/calendar-event-form";

export type CalendarConnectionTarget =
  | { kind: "add"; source: "sidebar" | "empty" }
  | { kind: "account"; accountId: string };

const accountConnectionActions = {
  "needs-mailbox": {
    description: "Connect this Gmail mailbox to use its calendars.",
    label: "Connect Gmail",
  },
  "needs-permission": {
    description: "Allow calendar access for this mailbox.",
    label: "Enable calendar",
  },
  "needs-reconnect": {
    description: "Reconnect this mailbox to refresh its calendars.",
    label: "Reconnect",
  },
} satisfies Record<
  Exclude<CalendarAccount["status"], "connected">,
  { description: string; label: string }
>;

type CalendarSidebarProps = {
  accounts: CalendarAccount[];
  calendars: CalendarSummary[];
  canCreate: boolean;
  date: string;
  hiddenCalendarKeys: string[];
  isConfigured: boolean;
  isMobileOpen: boolean;
  onConnect: (target: CalendarConnectionTarget) => void;
  onCreate: () => void;
  onDateChange: (date: string) => void;
  onMobileOpenChange: (open: boolean) => void;
  onToggleCalendar: (calendar: CalendarSummary) => void;
  onUpdateCalendarColor: (
    calendar: CalendarSummary,
    color: string
  ) => Promise<boolean>;
  pendingCalendarColorKey: string | null;
  pendingConnection: CalendarConnectionTarget | null;
  preview: boolean;
};

const CalendarColorControl = ({
  calendar,
  children,
  disabled,
  onUpdateCalendarColor,
  pending,
  presets,
}: Pick<CalendarSidebarProps, "onUpdateCalendarColor"> & {
  calendar: CalendarSummary;
  children: ReactNode;
  disabled: boolean;
  pending: boolean;
  presets: NonNullable<ComponentProps<typeof ColorPicker>["presets"]>;
}) => {
  const [draftColor, setDraftColor] = useState<string>();
  const color = calendar.color?.toLowerCase() ?? "var(--q-blue)";
  const isChanged = draftColor !== undefined && draftColor !== color;
  const applyColor = async (nextColor: string) => {
    if (await onUpdateCalendarColor(calendar, nextColor)) {
      setDraftColor(undefined);
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex min-w-0 items-center gap-2.5 py-1">
        {children}
        <ColorPicker
          disabled={disabled}
          label={`Change ${calendar.name} color`}
          onValueChange={setDraftColor}
          presets={presets}
          trigger="swatch"
          value={draftColor ?? color}
        />
      </div>
      {isChanged ? (
        <ActionFooter>
          <Button
            aria-label={`Cancel ${calendar.name} color change`}
            disabled={disabled}
            onClick={() => {
              setDraftColor(undefined);
            }}
            size="sm"
            variant="secondary"
          >
            Cancel
          </Button>
          <Button
            aria-label={`Apply ${calendar.name} color`}
            disabled={disabled}
            onClick={() => {
              void applyColor(draftColor);
            }}
            pending={pending}
            size="sm"
          >
            Apply
          </Button>
        </ActionFooter>
      ) : null}
    </div>
  );
};

const CalendarMailboxSettingsItem = ({
  close,
  mailboxId,
}: {
  close?: () => void;
  mailboxId: CalendarAccount["mailboxId"];
}) => {
  const returnTo = useLocation({ select: (location) => location.href });
  return (
    <DropdownMenuItem
      render={
        <Link
          onClick={close}
          search={{
            from: returnTo,
            mailboxId: mailboxId ?? "",
            tab: "mailboxes",
          }}
          to="/settings"
        />
      }
    >
      Manage mailbox
    </DropdownMenuItem>
  );
};

const CalendarSidebarContent = ({
  accounts,
  calendars,
  canCreate,
  close,
  date,
  hiddenCalendarKeys,
  isConfigured,
  onConnect,
  onCreate,
  onDateChange,
  onToggleCalendar,
  onUpdateCalendarColor,
  pendingCalendarColorKey,
  pendingConnection,
  preview,
}: Omit<CalendarSidebarProps, "isMobileOpen" | "onMobileOpenChange"> & {
  close?: () => void;
}) => {
  const selectedDate = new Date(`${date}T12:00:00`);
  const calendarColorNames = new Map<string, string>();
  for (const calendar of calendars) {
    if (calendar.color) {
      const color = calendar.color.toLowerCase();
      if (!calendarColorNames.has(color)) {
        calendarColorNames.set(color, calendar.name);
      }
    }
  }
  const colorPresets = [...calendarColorNames].map(([color, name]) => ({
    color,
    label: `Use ${name} color`,
    value: color,
  }));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 p-4">
      <div className="flex items-center gap-2">
        <Button
          fullWidth
          nativeButton={false}
          onClick={close}
          render={
            <Link
              resetScroll={false}
              search={(previous) => ({ ...previous, workspace: undefined })}
              to="/"
            />
          }
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- The shared Button renders a native anchor through its render slot.
          role="link"
          variant="ghost"
        >
          <Icon
            aria-hidden
            className="absolute start-3"
            icon={ArrowLeft01Icon}
          />
          Back to Mail
        </Button>
        {close ? (
          <IconButtonTooltip label="Close calendar sidebar">
            <Button
              aria-label="Close calendar sidebar"
              onClick={close}
              size="icon-sm"
              variant="ghost"
            >
              <Icon aria-hidden icon={Cancel01Icon} />
            </Button>
          </IconButtonTooltip>
        ) : null}
      </div>
      <Button
        disabled={!canCreate}
        fullWidth
        onClick={() => {
          onCreate();
          close?.();
        }}
      >
        New event
      </Button>
      <div className="-mx-2 min-h-0 flex-1 space-y-6 overflow-y-auto">
        <Calendar
          className="mx-auto"
          mode="single"
          month={selectedDate}
          onMonthChange={(month) => {
            onDateChange(
              `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-01`
            );
          }}
          onSelect={(value) => {
            if (value) {
              onDateChange(
                `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
              );
              close?.();
            }
          }}
          selected={selectedDate}
        />
        <div className="space-y-6 px-3">
          {accounts.map((account) => (
            <section className="space-y-2" key={account.id}>
              <div className="flex min-w-0 items-center gap-1">
                <h2
                  className="min-w-0 flex-1 truncate text-caption font-medium text-muted-fg"
                  title={account.email ?? account.name}
                >
                  {account.email ?? account.name}
                </h2>
                {preview ? null : (
                  <DropdownMenu>
                    <IconButtonTooltip label={`Manage ${account.name}`}>
                      <DropdownMenuTrigger
                        appearance="icon-transparent"
                        aria-label={`Manage ${account.name}`}
                      >
                        <Icon aria-hidden icon={MoreHorizontalIcon} />
                      </DropdownMenuTrigger>
                    </IconButtonTooltip>
                    <DropdownMenuContent align="start" size="compact">
                      <DropdownMenuItem
                        disabled={pendingConnection !== null}
                        onSelect={() => {
                          onConnect({ accountId: account.id, kind: "account" });
                        }}
                      >
                        Reconnect account
                      </DropdownMenuItem>
                      <CalendarMailboxSettingsItem
                        close={close}
                        mailboxId={account.mailboxId}
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {account.status === "connected" ? null : (
                <div className="space-y-2">
                  <p className="text-caption text-muted-fg">
                    {accountConnectionActions[account.status].description}
                  </p>
                  <Button
                    disabled={!isConfigured || pendingConnection !== null}
                    fullWidth
                    onClick={() => {
                      onConnect({ accountId: account.id, kind: "account" });
                    }}
                    pending={
                      pendingConnection?.kind === "account" &&
                      pendingConnection.accountId === account.id
                    }
                    size="sm"
                  >
                    {accountConnectionActions[account.status].label}
                  </Button>
                </div>
              )}
              {calendars
                .filter((calendar) => calendar.connectionId === account.id)
                .map((calendar) => (
                  <CalendarColorControl
                    calendar={calendar}
                    disabled={
                      account.status !== "connected" ||
                      pendingCalendarColorKey !== null
                    }
                    key={getCalendarRefKey(calendar)}
                    onUpdateCalendarColor={onUpdateCalendarColor}
                    pending={
                      pendingCalendarColorKey === getCalendarRefKey(calendar)
                    }
                    presets={colorPresets}
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-body-sm">
                      <Checkbox
                        aria-label={`Show ${calendar.name}`}
                        checked={
                          !hiddenCalendarKeys.includes(
                            getCalendarRefKey(calendar)
                          )
                        }
                        onCheckedChange={() => {
                          onToggleCalendar(calendar);
                        }}
                      >
                        <CheckboxIndicator />
                      </Checkbox>
                      <span
                        className="min-w-0 flex-1 truncate"
                        title={calendar.name}
                      >
                        {calendar.name}
                      </span>
                      {calendar.access === "read" ||
                      calendar.access === "busy" ? (
                        <Pill size="xs" tone="neutral">
                          Read only
                        </Pill>
                      ) : null}
                    </label>
                  </CalendarColorControl>
                ))}
            </section>
          ))}
          {preview ? null : (
            <Button
              disabled={!isConfigured || pendingConnection !== null}
              fullWidth
              onClick={() => {
                onConnect({ kind: "add", source: "sidebar" });
              }}
              pending={
                pendingConnection?.kind === "add" &&
                pendingConnection.source === "sidebar"
              }
              variant="ghost"
            >
              <Icon aria-hidden icon={Add01Icon} />
              Add Gmail mailbox
            </Button>
          )}
        </div>
      </div>
      <div className="mx-4 mb-4">
        <SidebarFooterLinks onRequestClose={close} />
      </div>
    </div>
  );
};

export const CalendarSidebar = ({
  isMobileOpen,
  onMobileOpenChange,
  ...props
}: CalendarSidebarProps) => (
  <WorkspaceSidebar
    isMobileOpen={isMobileOpen}
    label="Calendar sidebar"
    onMobileOpenChange={onMobileOpenChange}
  >
    {(close) => <CalendarSidebarContent {...props} close={close} />}
  </WorkspaceSidebar>
);
