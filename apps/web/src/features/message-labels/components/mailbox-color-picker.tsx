"use client";

import type { MailboxLabelColor } from "@quieter/mail/mailbox-organization";
import { cn } from "@quieter/ui/cn";

import { mailboxLabelDotClassNameByColor } from "#/features/message-labels/domain/mailbox-label-presentation";

const mailboxColors: MailboxLabelColor[] = [
  "gray",
  "blue",
  "cyan",
  "green",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple",
];

export const MailboxColorPicker = ({
  className,
  label,
  onChange,
  value,
}: {
  className?: string;
  label: string;
  onChange: (color: MailboxLabelColor) => void;
  value: MailboxLabelColor;
}) => (
  <fieldset
    aria-label={label}
    className={cn("flex flex-wrap items-center gap-1.5", className)}
  >
    {mailboxColors.map((color) => (
      <button
        aria-label={`${color} ${label.toLocaleLowerCase()}`}
        aria-pressed={value === color}
        className={cn(
          "size-5 rounded-full transition-transform hover:scale-110 motion-reduce:transition-none motion-reduce:hover:scale-100",
          mailboxLabelDotClassNameByColor[color],
          {
            "ring-2 ring-fg ring-offset-2 ring-offset-bg-raised":
              value === color,
          }
        )}
        key={color}
        onClick={() => {
          onChange(color);
        }}
        type="button"
      />
    ))}
  </fieldset>
);
