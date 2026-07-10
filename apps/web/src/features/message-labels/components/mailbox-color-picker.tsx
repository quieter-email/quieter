"use client";

import type { MailboxLabelColor } from "@quieter/mail/mailbox-organization";
import { cn } from "@quieter/ui/cn";
import { mailboxLabelDotClassNameByColor } from "~/features/message-labels/domain/mailbox-label-presentation";

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
  <fieldset aria-label={label} className={cn("flex flex-wrap items-center gap-1.5", className)}>
    {mailboxColors.map((color) => (
      <button
        aria-label={`${color} ${label.toLocaleLowerCase()}`}
        aria-pressed={value === color}
        className={cn(
          "size-5 rounded-full transition-transform outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring/30 motion-reduce:transition-none motion-reduce:hover:scale-100",
          mailboxLabelDotClassNameByColor[color],
          {
            "ring-2 ring-foreground ring-offset-2 ring-offset-background": value === color,
          },
        )}
        key={color}
        onClick={() => onChange(color)}
        type="button"
      />
    ))}
  </fieldset>
);
