"use client";

import { MailboxWorkspace } from "~/features/mailbox/components/mailbox-workspace";

type InboxPageClientProps = {
  user: {
    id?: string | null;
    email?: string | null;
    name?: string | null;
  };
};

export const InboxPageClient = ({ user }: InboxPageClientProps) => {
  return <MailboxWorkspace user={user} />;
};
