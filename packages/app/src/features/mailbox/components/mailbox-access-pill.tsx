import { Pill } from "@quieter/ui/pill";

export type MailboxGrantRole = "manager" | "reader" | "responder";

const mailboxAccessPresentation = {
  manager: { label: "Manager", tone: "purple" },
  reader: { label: "Reader", tone: "gray" },
  responder: { label: "Responder", tone: "blue" },
} as const;

export const MailboxAccessPill = ({ role }: { role: MailboxGrantRole }) => {
  const presentation = mailboxAccessPresentation[role];

  return <Pill tone={presentation.tone}>{presentation.label}</Pill>;
};
