"use client";

import type { MailboxLabelColor } from "@quieter/mail/mailbox-organization";
import { ColorSwatch } from "@quieter/ui/color-swatch";

export const MailboxLabelSwatch = ({
  color,
  kind = "label",
}: {
  color: MailboxLabelColor | null;
  kind?: "label" | "group";
}) => (
  <ColorSwatch
    color={
      color?.startsWith("#") === true ? color : `var(--q-${color ?? "gray"})`
    }
    shape={kind === "group" ? "circle" : "square"}
  />
);
