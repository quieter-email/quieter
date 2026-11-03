import type { MailboxLabelColor } from "@quieter/mail/mailbox-organization";
import type { PillTone } from "@quieter/ui/pill";

export const mailboxLabelPillToneByColor: Partial<
  Record<MailboxLabelColor, PillTone>
> = {
  blue: "blue",
  cyan: "cyan",
  gray: "gray",
  green: "green",
  orange: "orange",
  pink: "pink",
  purple: "purple",
  red: "red",
  yellow: "yellow",
};

export const mailboxLabelSearchPillSurfaceClassNameByColor: Partial<
  Record<MailboxLabelColor, string>
> = {
  blue: "bg-q-blue/65 dark:bg-q-blue/15",
  cyan: "bg-q-cyan/65 dark:bg-q-cyan/15",
  gray: "bg-q-gray/65 dark:bg-q-gray/15",
  green: "bg-q-green/65 dark:bg-q-green/15",
  orange: "bg-q-orange/65 dark:bg-q-orange/15",
  pink: "bg-q-pink/65 dark:bg-q-pink/15",
  purple: "bg-q-purple/65 dark:bg-q-purple/15",
  red: "bg-q-red/65 dark:bg-q-red/15",
  yellow: "bg-q-yellow/65 dark:bg-q-yellow/15",
};
