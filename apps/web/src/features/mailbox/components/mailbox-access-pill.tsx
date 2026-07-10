import { Pill } from "@quieter/ui/pill";

type MailboxGrantRole = "manager" | "reader" | "responder";

const mailboxAccessPresentation = {
  manager: { label: "Manager", tone: "access-manager" },
  reader: { label: "Reader", tone: "access-reader" },
  responder: { label: "Responder", tone: "access-responder" },
} as const;

export const MailboxAccessPill = ({ role }: { role: MailboxGrantRole }) => {
  const presentation = mailboxAccessPresentation[role];

  return <Pill tone={presentation.tone}>{presentation.label}</Pill>;
};
