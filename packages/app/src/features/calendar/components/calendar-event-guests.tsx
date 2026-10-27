"use client";

import { MoreHorizontalIcon, UserGroupIcon } from "@hugeicons/core-free-icons";
import type { CalendarEvent } from "@quieter/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@quieter/ui/field";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { Text } from "@quieter/ui/text";

export type CalendarEventGuestsProps = {
  attendees?: CalendarEvent["attendees"];
  value: string;
  optionalGuestEmails: string[];
  onChange: (value: string) => void;
  onOptionalGuestEmailsChange: (value: string[]) => void;
  disabled: boolean;
  preview: boolean;
};

export const CalendarEventGuests = ({
  attendees,
  value,
  optionalGuestEmails,
  onChange,
  onOptionalGuestEmailsChange,
  disabled,
  preview,
}: CalendarEventGuestsProps) => {
  const entries = value
    .split(/[,;\n]/u)
    .map((email) => email.trim())
    .filter(Boolean);
  const guests = [
    ...new Map(entries.map((email) => [email.toLowerCase(), email])).values(),
  ];
  const optionalEmails = new Set(
    optionalGuestEmails.map((email) => email.toLowerCase())
  );
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        <div className="flex h-8 items-center">
          <Icon icon={UserGroupIcon} tone="muted" />
        </div>
        <Field>
          <FieldLabel className="sr-only" htmlFor="calendar-event-guests">
            Guests
          </FieldLabel>
          <Input
            chrome="ghost"
            disabled={disabled}
            id="calendar-event-guests"
            onChange={(event) => {
              onChange(event.target.value);
            }}
            placeholder="Guest emails, separated by commas"
            value={value}
          />
          <FieldDescription className="ml-2.5">
            {preview
              ? "No invitations are sent from this preview."
              : "Guest notifications are off."}
          </FieldDescription>
        </Field>
      </div>
      <div className="ml-6 space-y-2 pl-2.5">
        {guests.map((email) => {
          const guest = attendees?.find(
            (attendee) => attendee.email.toLowerCase() === email.toLowerCase()
          );
          let status = preview ? "Preview guest" : "Not saved yet";
          if (guest) {
            const responses = {
              accepted: "Accepted",
              declined: "Declined",
              "needs-action": "Awaiting response",
              tentative: "Maybe",
            };
            status = guest.organizer ? "Organizer" : responses[guest.response];
          }
          return (
            <div
              className="flex min-w-0 items-center gap-2"
              key={email.toLowerCase()}
            >
              <div className="min-w-0 flex-1">
                <Text size="caption" title={email} truncate>
                  {guest?.name ?? email}
                  {guest?.self === true ? " (you)" : ""}
                </Text>
                <Text size="caption" tone="muted">
                  {status}
                  {optionalEmails.has(email.toLowerCase()) ? ", Optional" : ""}
                </Text>
              </div>
              {guest?.organizer === true ? null : (
                <DropdownMenu>
                  <IconButtonTooltip label={`Manage ${guest?.name ?? email}`}>
                    <DropdownMenuTrigger
                      appearance="icon-transparent"
                      aria-label={`Manage guest ${email}`}
                      disabled={disabled}
                    >
                      <Icon icon={MoreHorizontalIcon} />
                    </DropdownMenuTrigger>
                  </IconButtonTooltip>
                  <DropdownMenuContent align="end" size="compact">
                    <DropdownMenuItem
                      onSelect={() => {
                        const remaining = optionalGuestEmails.filter(
                          (optionalEmail) =>
                            optionalEmail.toLowerCase() !== email.toLowerCase()
                        );
                        onOptionalGuestEmailsChange(
                          optionalEmails.has(email.toLowerCase())
                            ? remaining
                            : [...remaining, email]
                        );
                      }}
                    >
                      {optionalEmails.has(email.toLowerCase())
                        ? "Mark as required"
                        : "Mark as optional"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      tone="destructive"
                      onSelect={() => {
                        onChange(
                          entries
                            .filter(
                              (entry) =>
                                entry.toLowerCase() !== email.toLowerCase()
                            )
                            .join(", ")
                        );
                        onOptionalGuestEmailsChange(
                          optionalGuestEmails.filter(
                            (optionalEmail) =>
                              optionalEmail.toLowerCase() !==
                              email.toLowerCase()
                          )
                        );
                      }}
                    >
                      Remove guest
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
