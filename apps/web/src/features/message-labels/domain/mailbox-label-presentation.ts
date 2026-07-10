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
  blue: "bg-label-blue-solid",
  cyan: "bg-label-cyan-solid",
  gray: "bg-label-gray-solid",
  green: "bg-label-green-solid",
  orange: "bg-label-orange-solid",
  pink: "bg-label-pink-solid",
  purple: "bg-label-purple-solid",
  red: "bg-label-red-solid",
  yellow: "bg-label-yellow-solid",
} satisfies Record<MailboxLabelColor, string>;
