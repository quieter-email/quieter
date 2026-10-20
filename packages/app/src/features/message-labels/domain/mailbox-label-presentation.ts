import type { MailboxLabelColor } from "@quieter/mail/mailbox-organization";
import type { PillTone } from "@quieter/ui/pill";

export const mailboxLabelPillToneByColor = {
  blue: "blue",
  cyan: "cyan",
  gray: "gray",
  green: "green",
  orange: "orange",
  pink: "pink",
  purple: "purple",
  red: "red",
  yellow: "yellow",
} satisfies Record<MailboxLabelColor, PillTone>;

export const mailboxLabelDotClassNameByColor = {
  blue: "bg-q-blue",
  cyan: "bg-q-cyan",
  gray: "bg-q-gray",
  green: "bg-q-green",
  orange: "bg-q-orange",
  pink: "bg-q-pink",
  purple: "bg-q-purple",
  red: "bg-q-red",
  yellow: "bg-q-yellow",
} satisfies Record<MailboxLabelColor, string>;

export const mailboxLabelSearchPillSurfaceClassNameByColor = {
  blue: "bg-q-blue/15 ring-q-blue/35 hover:bg-q-blue/20",
  cyan: "bg-q-cyan/15 ring-q-cyan/35 hover:bg-q-cyan/20",
  gray: "bg-q-gray/15 ring-q-gray/35 hover:bg-q-gray/20",
  green: "bg-q-green/15 ring-q-green/35 hover:bg-q-green/20",
  orange: "bg-q-orange/15 ring-q-orange/35 hover:bg-q-orange/20",
  pink: "bg-q-pink/15 ring-q-pink/35 hover:bg-q-pink/20",
  purple: "bg-q-purple/15 ring-q-purple/35 hover:bg-q-purple/20",
  red: "bg-q-red/15 ring-q-red/35 hover:bg-q-red/20",
  yellow: "bg-q-yellow/15 ring-q-yellow/35 hover:bg-q-yellow/20",
} satisfies Record<MailboxLabelColor, string>;
