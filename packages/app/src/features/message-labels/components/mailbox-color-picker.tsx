"use client";

import {
  mailboxLabelColorSchema,
  mailboxLabelNamedColorSchema,
} from "@quieter/mail/mailbox-organization";
import type { MailboxLabelColor } from "@quieter/mail/mailbox-organization";
import { ColorPicker } from "@quieter/ui/color-picker";

const presets = mailboxLabelNamedColorSchema.options.map((color) => ({
  color: `var(--q-${color})`,
  label: `${color.charAt(0).toUpperCase()}${color.slice(1)}`,
  value: color,
}));

export const MailboxColorPicker = ({
  className,
  disabled,
  label,
  onChange,
  onOpenChange,
  open,
  trigger,
  value,
}: {
  className?: string;
  disabled?: boolean;
  label: string;
  onChange: (color: MailboxLabelColor) => void;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  trigger?: "default" | "swatch";
  value: MailboxLabelColor;
}) => (
  <div className={className}>
    <ColorPicker
      disabled={disabled}
      label={label}
      onOpenChange={onOpenChange}
      onValueChange={(color) => {
        onChange(mailboxLabelColorSchema.parse(color));
      }}
      open={open}
      presets={presets}
      trigger={trigger}
      value={value.startsWith("#") ? value : `var(--q-${value})`}
    />
  </div>
);
