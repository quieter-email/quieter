"use client";

import { mailboxLabelColorSchema } from "@quieter/mail/mailbox-organization";
import type { MailboxLabelColor } from "@quieter/mail/mailbox-organization";
import { ColorPicker } from "@quieter/ui/color-picker";

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
  <div className={className}>
    <ColorPicker
      label={label}
      onValueChange={(color) => {
        onChange(mailboxLabelColorSchema.parse(color));
      }}
      value={value.startsWith("#") ? value : `var(--q-${value})`}
    />
  </div>
);
