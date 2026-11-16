import { ORPCError } from "@orpc/server";
import { db, withRequestDatabaseClient } from "@quieter/database/client";
import type { DatabaseTransaction } from "@quieter/database/client";
import {
  managedMailMessage,
  managedThreadCollaboration,
  managedThreadCollaborationEvent,
  managedThreadNote,
  managedThreadNoteMention,
  member,
  user,
} from "@quieter/database/schema";
import type { CollaborationPermissions } from "@quieter/mail/collaboration";
import type {
  CollaborationNote,
  CollaborationNoteCommand,
  CollaborationNoteGetInput,
  CollaborationNoteParticipants,
  CollaborationNoteParticipantsInput,
  CollaborationNoteResult,
  CollaborationNotesListInput,
  CollaborationNotesPage,
  CollaborationMentionsInput,
  CollaborationMentionsPage,
} from "@quieter/mail/collaboration-notes";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  or,
} from "drizzle-orm";

import { listMailUpdateRecipients } from "../../mail-updates";
import {
  authorizeCollaborationMailbox,
  authorizeCollaborationThread,
  lockCollaborationMailbox,
  lockCollaborationParticipant,
  lockCollaborationThread,
} from "./access";
import { projectCollaborationState } from "./state";

type Actor<Input> = Input & { userId: string };

const noteViews = async (
  input: {
    actorMemberId: string;
    notes: (typeof managedThreadNote.$inferSelect)[];
    organizationId: string;
    permissions: CollaborationPermissions;
  },
  transaction: DatabaseTransaction
): Promise<CollaborationNote[]> => {
  if (input.notes.length === 0) {
    return [];
  }
  const authorIds = input.notes.flatMap((note) =>
    note.authorMemberId === null ? [] : [note.authorMemberId]
  );
  const authors =
    authorIds.length === 0
      ? []
      : await transaction
          .select({ memberId: member.id, name: user.name })
          .from(member)
          .innerJoin(user, eq(user.id, member.userId))
          .where(
            and(
              eq(member.organizationId, input.organizationId),
              inArray(member.id, authorIds)
            )
          );
  const mentions = await transaction
    .select({
      memberId: member.id,
      name: user.name,
      noteId: managedThreadNoteMention.noteId,
    })
    .from(managedThreadNoteMention)
    .innerJoin(
      member,
      eq(member.id, managedThreadNoteMention.recipientMemberId)
    )
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        inArray(
          managedThreadNoteMention.noteId,
          input.notes.map((note) => note.id)
        ),
        eq(member.organizationId, input.organizationId)
      )
    )
    .orderBy(asc(member.id));
  const authorById = new Map(
    authors.map((author) => [author.memberId, author])
  );
  return input.notes.map((note) => {
    const author =
      note.authorMemberId === null
        ? undefined
        : authorById.get(note.authorMemberId);
    const own = note.authorMemberId === input.actorMemberId;
    return {
      actions: {
        edit: own && input.permissions.writeOwnNotes,
        remove:
          (own && input.permissions.writeOwnNotes) ||
          input.permissions.moderateNotes,
      },
      author:
        author === undefined
          ? { kind: "former-member" }
          : { kind: "member", ...author },
      body: note.body,
      createdAt: note.createdAt.toISOString(),
      id: note.id,
      mentions: mentions
        .filter((mention) => mention.noteId === note.id)
        .map(({ memberId, name }) => ({ memberId, name })),
      updatedAt: note.updatedAt.toISOString(),
    };
  });
};

export const listCollaborationNotes = async (
  input: Actor<CollaborationNotesListInput>
): Promise<CollaborationNotesPage> =>
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
          for (const cursor of [input.at, input.after]) {
            if (
              cursor !== undefined &&
              (context === undefined ||
                cursor.contextId !== context.id ||
                cursor.revision !== context.revision.toString())
            ) {
              throw new ORPCError("CONFLICT", {
                message: "These notes changed. Refresh before continuing.",
              });
            }
          }
          const rows =
            context === undefined
              ? []
              : await transaction
                  .select()
                  .from(managedThreadNote)
                  .where(
                    and(
                      eq(managedThreadNote.contextId, context.id),
                      input.after === undefined
                        ? undefined
                        : or(
                            lt(
                              managedThreadNote.createdAt,
                              new Date(input.after.createdAt)
                            ),
                            and(
                              eq(
                                managedThreadNote.createdAt,
                                new Date(input.after.createdAt)
                              ),
                              lt(managedThreadNote.id, input.after.noteId)
                            )
                          )
                    )
                  )
                  .orderBy(
                    desc(managedThreadNote.createdAt),
                    desc(managedThreadNote.id)
                  )
                  .limit(26);
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
          const snapshot = projectCollaborationState(
            input,
            current.role,
            context
          );
          const page = rows.slice(0, 25);
          const notes = await noteViews(
            {
              actorMemberId: locked.actorMemberId,
              notes: page,
              organizationId: current.organizationId,
              permissions: snapshot.permissions,
            },
            transaction
          );
          const final = await authorizeCollaborationThread(input, transaction);
          if (
            final.organizationId !== current.organizationId ||
            final.role !== current.role
          ) {
            throw new ORPCError("CONFLICT", {
              message: "Your team access changed. Refresh and try again.",
            });
          }
          const last = page.at(-1);
          return {
            next:
              rows.length > 25 && context !== undefined && last !== undefined
                ? {
                    contextId: context.id,
                    createdAt: last.createdAt.toISOString(),
                    noteId: last.id,
                    revision: context.revision.toString(),
                  }
                : null,
            notes,
            snapshot,
          };
        },
        { isolationLevel: "read committed" }
      )
  );

export const getCollaborationNote = async (
  input: Actor<CollaborationNoteGetInput>
): Promise<CollaborationNoteResult> =>
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
          const rows =
            context?.id === input.contextId
              ? await transaction
                  .select()
                  .from(managedThreadNote)
                  .where(
                    and(
                      eq(managedThreadNote.contextId, context.id),
                      eq(managedThreadNote.id, input.noteId)
                    )
                  )
                  .limit(1)
              : [];
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
          const snapshot = projectCollaborationState(
            input,
            current.role,
            context
          );
          const views = await noteViews(
            {
              actorMemberId: locked.actorMemberId,
              notes: rows,
              organizationId: current.organizationId,
              permissions: snapshot.permissions,
            },
            transaction
          );
          const final = await authorizeCollaborationThread(input, transaction);
          if (
            final.organizationId !== current.organizationId ||
            final.role !== current.role
          ) {
            throw new ORPCError("CONFLICT", {
              message: "Your team access changed. Refresh and try again.",
            });
          }
          return { note: views[0] ?? null, snapshot };
        },
        { isolationLevel: "read committed" }
      )
  );

export const listCollaborationNoteParticipants = async (
  input: Actor<CollaborationNoteParticipantsInput>
): Promise<CollaborationNoteParticipants> =>
  await withRequestDatabaseClient(
    async () =>
      await db.transaction(
        async (transaction) => {
          const locked = await lockCollaborationThread(input, transaction);
          const recipients = await listMailUpdateRecipients(
            input.mailboxId,
            transaction
          );
          const search = input.search
            ?.replaceAll("\\", "\\\\")
            .replaceAll("%", "\\%")
            .replaceAll("_", "\\_");
          const rows =
            recipients.length === 0
              ? []
              : await transaction
                  .select({ memberId: member.id, name: user.name })
                  .from(member)
                  .innerJoin(user, eq(user.id, member.userId))
                  .where(
                    and(
                      eq(member.organizationId, locked.mailbox.organizationId),
                      inArray(member.userId, recipients),
                      input.afterMemberId === undefined
                        ? undefined
                        : gt(member.id, input.afterMemberId),
                      search ? ilike(user.name, `%${search}%`) : undefined
                    )
                  )
                  .orderBy(asc(member.id))
                  .limit(51);
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
          const page = rows.slice(0, 50);
          return {
            nextMemberId:
              rows.length > 50 ? (page.at(-1)?.memberId ?? null) : null,
            participants: page,
            snapshot: projectCollaborationState(input, current.role, context),
          };
        },
        { isolationLevel: "read committed" }
      )
  );

export const mutateCollaborationNote = async (
  input: Actor<CollaborationNoteCommand>
): Promise<CollaborationNoteResult> =>
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
          if (
            context === undefined ||
            context.id !== input.expected.contextId ||
            context.revision.toString() !== input.expected.revision
          ) {
            throw new ORPCError("CONFLICT", {
              message: "These notes changed. Refresh before saving your note.",
            });
          }
          const [existing] =
            input.kind === "create"
              ? []
              : await transaction
                  .select()
                  .from(managedThreadNote)
                  .where(
                    and(
                      eq(managedThreadNote.contextId, context.id),
                      eq(managedThreadNote.id, input.noteId)
                    )
                  )
                  .limit(1);
          const { permissions } = projectCollaborationState(
            input,
            locked.mailbox.role,
            context
          );
          if (
            !permissions.writeOwnNotes ||
            (input.kind === "edit" &&
              existing?.authorMemberId !== locked.actorMemberId) ||
            (input.kind === "remove" &&
              existing?.authorMemberId !== locked.actorMemberId &&
              !permissions.moderateNotes)
          ) {
            throw new ORPCError("FORBIDDEN", {
              message: "You do not have permission to change this note.",
            });
          }
          if (input.kind !== "create" && existing === undefined) {
            throw new ORPCError("CONFLICT", {
              message:
                "This note is no longer available. Refresh and try again.",
            });
          }
          const targets: { id: string; userId: string }[] = [];
          if (input.kind !== "remove") {
            for (const memberId of input.mentionMemberIds.toSorted()) {
              targets.push(
                await lockCollaborationParticipant(
                  {
                    mailboxId: input.mailboxId,
                    memberId,
                    organizationId: locked.mailbox.organizationId,
                  },
                  transaction
                )
              );
            }
          }
          const now = new Date(
            Math.max(
              Date.now(),
              context.updatedAt.getTime(),
              existing?.updatedAt.getTime() ?? 0
            )
          );
          if (input.kind === "create") {
            const [created] = await transaction
              .insert(managedThreadNote)
              .values({
                authorMemberId: locked.actorMemberId,
                body: input.body,
                contextId: context.id,
                createdAt: now,
                id: input.noteId,
                updatedAt: now,
              })
              .onConflictDoNothing()
              .returning({ id: managedThreadNote.id });
            if (created === undefined) {
              throw new ORPCError("CONFLICT", {
                message: "This note already exists. Refresh before continuing.",
              });
            }
          } else if (input.kind === "edit") {
            await transaction
              .update(managedThreadNote)
              .set({ body: input.body, updatedAt: now })
              .where(
                and(
                  eq(managedThreadNote.contextId, context.id),
                  eq(managedThreadNote.id, input.noteId)
                )
              );
          } else {
            await transaction
              .delete(managedThreadNote)
              .where(
                and(
                  eq(managedThreadNote.contextId, context.id),
                  eq(managedThreadNote.id, input.noteId)
                )
              );
          }
          if (input.kind !== "remove") {
            const previous = await transaction
              .select()
              .from(managedThreadNoteMention)
              .where(eq(managedThreadNoteMention.noteId, input.noteId));
            const selected = new Set(targets.map((target) => target.id));
            const removed = previous.filter(
              (mention) => !selected.has(mention.recipientMemberId)
            );
            if (removed.length > 0) {
              await transaction.delete(managedThreadNoteMention).where(
                and(
                  eq(managedThreadNoteMention.noteId, input.noteId),
                  inArray(
                    managedThreadNoteMention.recipientMemberId,
                    removed.map((mention) => mention.recipientMemberId)
                  )
                )
              );
            }
            const retained = new Set(
              previous.map((mention) => mention.recipientMemberId)
            );
            const added = targets.filter((target) => !retained.has(target.id));
            if (added.length > 0) {
              await transaction.insert(managedThreadNoteMention).values(
                added.map((target) => ({
                  createdAt: now,
                  noteId: input.noteId,
                  readAt: target.id === locked.actorMemberId ? now : null,
                  recipientMemberId: target.id,
                }))
              );
            }
          }
          const revision = context.revision + 1n;
          await transaction
            .update(managedThreadCollaboration)
            .set({ revision, updatedAt: now })
            .where(eq(managedThreadCollaboration.id, context.id));
          const kind = {
            create: "note_created",
            edit: "note_edited",
            remove: "note_deleted",
          } satisfies Record<
            CollaborationNoteCommand["kind"],
            typeof managedThreadCollaborationEvent.$inferInsert.kind
          >;
          await transaction.insert(managedThreadCollaborationEvent).values({
            actorMemberId: locked.actorMemberId,
            contextId: context.id,
            createdAt: now,
            kind: kind[input.kind],
            noteId: input.noteId,
            revision,
          });
          if (revision > 500n) {
            await transaction
              .delete(managedThreadCollaborationEvent)
              .where(
                and(
                  eq(managedThreadCollaborationEvent.contextId, context.id),
                  lt(managedThreadCollaborationEvent.revision, revision - 499n)
                )
              );
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
          const snapshot = projectCollaborationState(input, current.role, {
            ...context,
            revision,
            updatedAt: now,
          });
          if (
            !snapshot.permissions.writeOwnNotes ||
            (input.kind === "remove" &&
              existing?.authorMemberId !== locked.actorMemberId &&
              !snapshot.permissions.moderateNotes)
          ) {
            throw new ORPCError("FORBIDDEN", {
              message: "You do not have permission to change this note.",
            });
          }
          for (const target of targets) {
            await lockCollaborationParticipant(
              {
                mailboxId: input.mailboxId,
                memberId: target.id,
                organizationId: current.organizationId,
              },
              transaction
            );
          }
          const changed =
            input.kind === "remove"
              ? []
              : await transaction
                  .select()
                  .from(managedThreadNote)
                  .where(
                    and(
                      eq(managedThreadNote.contextId, context.id),
                      eq(managedThreadNote.id, input.noteId)
                    )
                  )
                  .limit(1);
          const views = await noteViews(
            {
              actorMemberId: locked.actorMemberId,
              notes: changed,
              organizationId: current.organizationId,
              permissions: snapshot.permissions,
            },
            transaction
          );
          const final = await authorizeCollaborationThread(input, transaction);
          if (
            final.organizationId !== current.organizationId ||
            final.role !== current.role
          ) {
            throw new ORPCError("CONFLICT", {
              message: "Your team access changed. Refresh and try again.",
            });
          }
          return { note: views[0] ?? null, snapshot };
        },
        { isolationLevel: "read committed" }
      )
  );

export const listCollaborationMentions = async (
  input: Actor<CollaborationMentionsInput>
): Promise<CollaborationMentionsPage> =>
  await withRequestDatabaseClient(
    async () =>
      await db.transaction(
        async (transaction) => {
          const locked = await lockCollaborationMailbox(input, transaction);
          const rows = await transaction
            .select({
              contextId: managedThreadCollaboration.id,
              createdAt: managedThreadNoteMention.createdAt,
              noteId: managedThreadNote.id,
              threadId: managedThreadCollaboration.threadId,
            })
            .from(managedThreadNoteMention)
            .innerJoin(
              managedThreadNote,
              eq(managedThreadNote.id, managedThreadNoteMention.noteId)
            )
            .innerJoin(
              managedThreadCollaboration,
              eq(managedThreadCollaboration.id, managedThreadNote.contextId)
            )
            .where(
              and(
                eq(managedThreadCollaboration.mailboxId, input.mailboxId),
                eq(
                  managedThreadNoteMention.recipientMemberId,
                  locked.actorMemberId
                ),
                isNull(managedThreadNoteMention.readAt),
                exists(
                  transaction
                    .select({ id: managedMailMessage.id })
                    .from(managedMailMessage)
                    .where(
                      and(
                        eq(managedMailMessage.mailboxId, input.mailboxId),
                        eq(
                          managedMailMessage.threadId,
                          managedThreadCollaboration.threadId
                        )
                      )
                    )
                ),
                input.after === undefined
                  ? undefined
                  : or(
                      lt(
                        managedThreadNoteMention.createdAt,
                        new Date(input.after.createdAt)
                      ),
                      and(
                        eq(
                          managedThreadNoteMention.createdAt,
                          new Date(input.after.createdAt)
                        ),
                        lt(managedThreadNoteMention.noteId, input.after.noteId)
                      )
                    )
              )
            )
            .orderBy(
              desc(managedThreadNoteMention.createdAt),
              desc(managedThreadNoteMention.noteId)
            )
            .limit(26);
          const current = await authorizeCollaborationMailbox(
            input,
            transaction
          );
          if (current.organizationId !== locked.mailbox.organizationId) {
            throw new ORPCError("NOT_FOUND", {
              data: { resource: "mailbox" },
              message: "Conversation is not available.",
            });
          }
          const page = rows.slice(0, 25);
          const last = page.at(-1);
          return {
            mentions: page.map((mention) => ({
              ...mention,
              createdAt: mention.createdAt.toISOString(),
              href: projectCollaborationState(
                { ...input, threadId: mention.threadId },
                current.role
              ).href,
              mailboxId: input.mailboxId,
            })),
            next:
              rows.length > 25 && last !== undefined
                ? {
                    createdAt: last.createdAt.toISOString(),
                    noteId: last.noteId,
                  }
                : null,
          };
        },
        { isolationLevel: "read committed" }
      )
  );

export const acknowledgeCollaborationMention = async (
  input: Actor<CollaborationNoteGetInput>
): Promise<{ acknowledged: boolean }> =>
  await withRequestDatabaseClient(
    async () =>
      await db.transaction(
        async (transaction) => {
          const locked = await lockCollaborationThread(input, transaction);
          const [mention] = await transaction
            .select({
              createdAt: managedThreadNoteMention.createdAt,
              readAt: managedThreadNoteMention.readAt,
            })
            .from(managedThreadNoteMention)
            .innerJoin(
              managedThreadNote,
              eq(managedThreadNote.id, managedThreadNoteMention.noteId)
            )
            .innerJoin(
              managedThreadCollaboration,
              eq(managedThreadCollaboration.id, managedThreadNote.contextId)
            )
            .where(
              and(
                eq(managedThreadCollaboration.id, input.contextId),
                eq(managedThreadCollaboration.mailboxId, input.mailboxId),
                eq(managedThreadCollaboration.threadId, input.threadId),
                eq(managedThreadNoteMention.noteId, input.noteId),
                eq(
                  managedThreadNoteMention.recipientMemberId,
                  locked.actorMemberId
                )
              )
            )
            .limit(1);
          if (mention !== undefined && mention.readAt === null) {
            await transaction
              .update(managedThreadNoteMention)
              .set({
                readAt: new Date(
                  Math.max(Date.now(), mention.createdAt.getTime())
                ),
              })
              .where(
                and(
                  eq(managedThreadNoteMention.noteId, input.noteId),
                  eq(
                    managedThreadNoteMention.recipientMemberId,
                    locked.actorMemberId
                  )
                )
              );
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
          return { acknowledged: mention !== undefined };
        },
        { isolationLevel: "read committed" }
      )
  );
