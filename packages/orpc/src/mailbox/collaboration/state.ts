import type {
  MailboxGrantRole,
  managedThreadCollaboration,
} from "@quieter/database/schema";
import type {
  CollaborationPermissions,
  CollaborationScope,
  CollaborationState,
} from "@quieter/mail/collaboration";

const permissionsByRole = {
  manager: {
    assignOthers: true,
    claimSelf: true,
    moderateNotes: true,
    read: true,
    writeOwnNotes: true,
  },
  reader: {
    assignOthers: false,
    claimSelf: false,
    moderateNotes: false,
    read: true,
    writeOwnNotes: false,
  },
  responder: {
    assignOthers: false,
    claimSelf: true,
    moderateNotes: false,
    read: true,
    writeOwnNotes: true,
  },
} satisfies Record<MailboxGrantRole, CollaborationPermissions>;

export const projectCollaborationState = (
  input: CollaborationScope,
  role: MailboxGrantRole,
  context?: typeof managedThreadCollaboration.$inferSelect
): CollaborationState => {
  const search = new URLSearchParams({
    mailboxId: input.mailboxId,
    threadId: input.threadId,
  });
  return {
    href: `/?${search.toString()}`,
    mailboxId: input.mailboxId,
    permissions: { ...permissionsByRole[role] },
    role,
    state:
      context === undefined
        ? { kind: "unprepared" }
        : {
            cursor: {
              contextId: context.id,
              revision: context.revision.toString(),
            },
            kind: "prepared",
          },
    threadId: input.threadId,
  };
};
