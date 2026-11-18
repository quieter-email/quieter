import { ORPCError } from "@orpc/server";
import { db, withRequestDatabaseClient } from "@quieter/database/client";
import {
  managedThreadCollaboration,
  managedThreadCollaborationEvent,
} from "@quieter/database/schema";
import type { MailboxGrantRole } from "@quieter/database/schema";
import { compareCollaborationCursor } from "@quieter/mail/collaboration";
import type {
  CollaborationChanges,
  CollaborationChangesInput,
  CollaborationPermissions,
  CollaborationState,
} from "@quieter/mail/collaboration";
import { and, eq } from "drizzle-orm";

import {
  authorizeCollaborationThread,
  lockCollaborationThread,
} from "./access";
import type { CollaborationActorScope } from "./access";

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

const snapshotFor = (
  input: CollaborationActorScope,
  role: MailboxGrantRole,
  context: typeof managedThreadCollaboration.$inferSelect | undefined
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

export const getCollaboration = async (
  input: CollaborationActorScope
): Promise<CollaborationState> =>
  await withRequestDatabaseClient(
    async () =>
      await db.transaction(
        async (transaction) => {
          const locked = await lockCollaborationThread(input, transaction);
          const [context] = await transaction
            .select()
            .from(managedThreadCollaboration)
            .where(
              and(
                eq(managedThreadCollaboration.mailboxId, input.mailboxId),
                eq(managedThreadCollaboration.threadId, input.threadId)
              )
            )
            .limit(1);
          const current = await authorizeCollaborationThread(
            input,
            transaction
          );
          if (current.organizationId !== locked.mailbox.organizationId) {
            throw new ORPCError("NOT_FOUND", {
              data: { resource: "mailbox" },
              message: "Conversation is not available.",
            });
          }
          return snapshotFor(input, current.role, context);
        },
        { isolationLevel: "read committed" }
      )
  );

export const prepareCollaboration = async (
  input: CollaborationActorScope
): Promise<CollaborationState> =>
  await withRequestDatabaseClient(
    async () =>
      await db.transaction(
        async (transaction) => {
          const locked = await lockCollaborationThread(input, transaction);
          if (locked.mailbox.role === "reader") {
            throw new ORPCError("FORBIDDEN", {
              message: "You need reply access to start collaborating.",
            });
          }
          const now = new Date();
          const [created] = await transaction
            .insert(managedThreadCollaboration)
            .values({
              createdAt: now,
              id: crypto.randomUUID(),
              mailboxId: input.mailboxId,
              revision: 1n,
              threadId: input.threadId,
              updatedAt: now,
            })
            .onConflictDoNothing({
              target: [
                managedThreadCollaboration.mailboxId,
                managedThreadCollaboration.threadId,
              ],
            })
            .returning();
          if (created !== undefined) {
            await transaction.insert(managedThreadCollaborationEvent).values({
              actorMemberId: locked.actorMemberId,
              contextId: created.id,
              createdAt: now,
              kind: "prepared",
              revision: created.revision,
            });
          }
          const [context] = await transaction
            .select()
            .from(managedThreadCollaboration)
            .where(
              and(
                eq(managedThreadCollaboration.mailboxId, input.mailboxId),
                eq(managedThreadCollaboration.threadId, input.threadId)
              )
            )
            .limit(1);
          if (context === undefined) {
            throw new ORPCError("CONFLICT", {
              message: "This conversation changed. Refresh and try again.",
            });
          }
          const current = await authorizeCollaborationThread(
            input,
            transaction
          );
          if (current.organizationId !== locked.mailbox.organizationId) {
            throw new ORPCError("NOT_FOUND", {
              data: { resource: "mailbox" },
              message: "Conversation is not available.",
            });
          }
          if (current.role === "reader") {
            throw new ORPCError("FORBIDDEN", {
              message: "You need reply access to start collaborating.",
            });
          }
          return snapshotFor(input, current.role, context);
        },
        { isolationLevel: "read committed" }
      )
  );

export const getCollaborationChanges = async (
  input: CollaborationChangesInput & { userId: string }
): Promise<CollaborationChanges> => {
  const snapshot = await getCollaboration(input);
  return {
    ...compareCollaborationCursor(snapshot.state, input.after),
    snapshot,
  };
};
