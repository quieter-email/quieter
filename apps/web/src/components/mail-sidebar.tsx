import { createMemo } from "solid-js";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import { useSession } from "~/lib/auth";
import { SIDEBAR_WIDTH, SidebarMailboxNav, SidebarProfileDialog } from "./sidebar";

type MailSidebarProps = {
  selectedMailbox: MailboxCategory;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
};

export const MailSidebar = (props: MailSidebarProps) => {
  const session = useSession();

  const profileName = createMemo(() => {
    const name = session().data?.user?.name;
    if (typeof name === "string" && name.trim().length > 0) {
      return name.trim();
    }

    const email = session().data?.user?.email;
    if (typeof email === "string" && email.trim().length > 0) {
      return email.trim();
    }

    return "Profile";
  });

  const profileEmail = createMemo(() => {
    const email = session().data?.user?.email;
    if (typeof email === "string" && email.trim().length > 0) {
      return email.trim();
    }

    return "No email available";
  });

  const profileInitial = createMemo(() => profileName().charAt(0).toUpperCase() || "Q");

  return (
    <aside
      class="hidden h-full shrink-0 border-r border-border bg-background text-foreground lg:flex lg:flex-col"
      style={{ width: `${SIDEBAR_WIDTH}px` }}
    >
      <SidebarProfileDialog
        initial={profileInitial()}
        name={profileName()}
        email={profileEmail()}
      />

      <SidebarMailboxNav
        selectedMailbox={props.selectedMailbox}
        onSelectMailbox={props.onSelectMailbox}
      />
    </aside>
  );
};
