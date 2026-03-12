"use client";

import dynamic from "next/dynamic";

type InboxPageClientProps = {
  user: {
    id?: string | null;
    email?: string | null;
    name?: string | null;
  };
};

const MailboxWorkspace = dynamic(
  () => import("~/components/mailbox-workspace").then((module) => module.MailboxWorkspace),
  {
    ssr: false,
    loading: () => <main className="h-screen bg-background" />,
  },
);

export const InboxPageClient = ({ user }: InboxPageClientProps) => {
  return <MailboxWorkspace user={user} />;
};
