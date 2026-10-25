"use client";

import {
  Add01Icon,
  ArrowLeft01Icon,
  Calendar03Icon,
  Cancel01Icon,
  LayoutRightIcon,
  MoreHorizontalIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AssistantSidebarContext } from "@quieter/app/features/chat/components/assistant-sidebar-context";
import type { CalendarAccount, CalendarSummary } from "@quieter/calendar";
import { Button, LinkButton } from "@quieter/ui/button";
import { Calendar } from "@quieter/ui/calendar";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Pill } from "@quieter/ui/pill";
import { WorkspaceSidebar } from "@quieter/ui/workspace-sidebar";
import { use } from "react";

import { getCalendarRefKey } from "../domain/calendar-event-form";

type CalendarSidebarProps = {
  accounts: CalendarAccount[];
  calendars: CalendarSummary[];
  canCreate: boolean;
  connecting: boolean;
  date: string;
  hiddenCalendarKeys: string[];
  isConfigured: boolean;
  isMobileOpen: boolean;
  onBackToMail: () => void;
  onConnect: () => void;
  onCreate: () => void;
  onDateChange: (date: string) => void;
  onDisconnect: (account: CalendarAccount) => void;
  onMobileOpenChange: (open: boolean) => void;
  onToggleCalendar: (calendar: CalendarSummary) => void;
  preview: boolean;
};

const CalendarSidebarContent = ({
  accounts,
  calendars,
  canCreate,
  close,
  connecting,
  date,
  hiddenCalendarKeys,
  isConfigured,
  onBackToMail,
  onConnect,
  onCreate,
  onDateChange,
  onDisconnect,
  onToggleCalendar,
  preview,
}: Omit<CalendarSidebarProps, "isMobileOpen" | "onMobileOpenChange"> & {
  close?: () => void;
}) => {
  const assistant = use(AssistantSidebarContext);
  const selectedDate = new Date(`${date}T12:00:00`);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 p-4">
      <div className="flex items-center gap-2">
        <Button
          fullWidth
          onClick={() => {
            close?.();
            onBackToMail();
          }}
          variant="ghost"
        >
          <HugeiconsIcon aria-hidden icon={ArrowLeft01Icon} />
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
              <HugeiconsIcon aria-hidden icon={Cancel01Icon} />
            </Button>
          </IconButtonTooltip>
        ) : null}
      </div>
      <div className="flex items-center gap-2 px-2">
        <HugeiconsIcon
          aria-hidden
          className="size-5 text-muted-fg"
          icon={Calendar03Icon}
        />
        <h1 className="text-title-sm font-medium">Calendar</h1>
      </div>
      <Button
        disabled={!canCreate}
        fullWidth
        onClick={() => {
          onCreate();
          close?.();
        }}
      >
        <HugeiconsIcon aria-hidden icon={Add01Icon} />
        New event
      </Button>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto">
        <Calendar
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
          weekStartsOn={1}
        />
        <div className="space-y-5 px-1">
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
                        <HugeiconsIcon
                          aria-hidden
                          className="size-4"
                          icon={MoreHorizontalIcon}
                        />
                      </DropdownMenuTrigger>
                    </IconButtonTooltip>
                    <DropdownMenuContent align="start" size="compact">
                      <DropdownMenuItem onSelect={onConnect}>
                        Reconnect account
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          onDisconnect(account);
                        }}
                        tone="destructive"
                      >
                        Disconnect account
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {account.status === "needs-reconnect" ? (
                <div className="space-y-2">
                  <p className="text-caption text-muted-fg">
                    Reconnect to refresh these calendars.
                  </p>
                  <Button
                    fullWidth
                    onClick={onConnect}
                    pending={connecting}
                    size="sm"
                  >
                    Reconnect
                  </Button>
                </div>
              ) : null}
              {calendars
                .filter((calendar) => calendar.connectionId === account.id)
                .map((calendar) => (
                  <label
                    className="flex cursor-pointer items-center gap-2.5 py-1 text-body-sm"
                    key={getCalendarRefKey(calendar)}
                  >
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
                ))}
            </section>
          ))}
          {preview ? null : (
            <Button
              disabled={!isConfigured}
              fullWidth
              onClick={onConnect}
              pending={connecting}
              variant="ghost"
            >
              <HugeiconsIcon aria-hidden icon={Add01Icon} />
              Connect a calendar account
            </Button>
          )}
        </div>
      </div>
      <div className="space-y-1">
        {assistant && !assistant.open ? (
          <Button
            aria-controls={assistant.panelId}
            aria-expanded={assistant.open}
            data-assistant-launcher
            fullWidth
            onClick={(event) => {
              assistant.onOpen(event.currentTarget);
              close?.();
            }}
            variant="ghost"
          >
            <HugeiconsIcon aria-hidden icon={LayoutRightIcon} />
            Open assistant
          </Button>
        ) : null}
        <LinkButton
          fullWidth
          onClick={close}
          search={{ from: "/" }}
          to="/settings"
          variant="ghost"
        >
          <HugeiconsIcon aria-hidden icon={Settings01Icon} />
          Settings
        </LinkButton>
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
