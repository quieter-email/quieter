import { ORPCError } from "@orpc/server";
import type { DatabaseTransaction } from "@quieter/database/client";
import {
  mailbox,
  managedMailMessage,
  member,
  organization,
} from "@quieter/database/schema";
import type { CollaborationScope } from "@quieter/mail/collaboration";
import { and, eq, isNull, sql } from "drizzle-orm";

import { getAuthorizedManagedMailbox } from "../access";

export type CollaborationActorScope = CollaborationScope & { userId: string };

const throwCollaborationLockError = (error: unknown): never => {
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause
      : error;
  if (cause instanceof Error && "code" in cause && cause.code === "55P03") {
    throw new ORPCError("CONFLICT", {
      cause: error,
      message: "Your team access is changing. Try again.",
    });
  }
  throw error;
};

export const authorizeCollaborationThread = async (
  input: CollaborationActorScope,
  database: Pick<DatabaseTransaction, "select">
) => {
  const authorized = await getAuthorizedManagedMailbox(input, database).catch(
    (error: unknown) => {
      if (!(error instanceof ORPCError) || error.code !== "NOT_FOUND") {
        throw error;
      }
      throw new ORPCError("NOT_FOUND", {
        data: { resource: "mailbox" },
        message: "Conversation is not available.",
      });
    }
  );
  if (authorized.ownerUserId !== null || authorized.organizationId === null) {
    throw new ORPCError("NOT_FOUND", {
      data: { resource: "mailbox" },
      message: "Conversation is not available.",
    });
  }
  const [message] = await database
    .select({ id: managedMailMessage.id })
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        eq(managedMailMessage.threadId, input.threadId)
      )
    )
    .limit(1);
  if (message === undefined) {
    throw new ORPCError("NOT_FOUND", {
      message: "Conversation is not available.",
    });
  }
  return { ...authorized, organizationId: authorized.organizationId };
};

export const lockCollaborationThread = async (
  input: CollaborationActorScope,
  transaction: DatabaseTransaction
) => {
  const initial = await authorizeCollaborationThread(input, transaction);
  const [team] = await transaction
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, initial.organizationId))
    .limit(1)
    .for("key share");
  if (team === undefined) {
    throw new ORPCError("NOT_FOUND", {
      data: { resource: "mailbox" },
      message: "Conversation is not available.",
    });
  }
  const [actor] = await transaction
    .select({ id: member.id })
    .from(member)
    .where(
      and(eq(member.organizationId, team.id), eq(member.userId, input.userId))
    )
    .limit(1)
    .for("key share", { noWait: true })
    .catch(throwCollaborationLockError);
  if (actor === undefined) {
    throw new ORPCError("NOT_FOUND", {
      data: { resource: "mailbox" },
      message: "Conversation is not available.",
    });
  }
  const [sharedMailbox] = await transaction
    .select({ id: mailbox.id })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.id, input.mailboxId),
        eq(mailbox.organizationId, team.id),
        eq(mailbox.provider, "managed"),
        isNull(mailbox.managedOwnerUserId)
      )
    )
    .limit(1)
    .for("key share", { noWait: true })
    .catch(throwCollaborationLockError);
  if (sharedMailbox === undefined) {
    throw new ORPCError("NOT_FOUND", {
      data: { resource: "mailbox" },
      message: "Conversation is not available.",
    });
  }
  await transaction.execute(sql`
    select pg_advisory_xact_lock(hashtextextended(jsonb_build_array(
      'quieter-managed-collaboration-v1', ${input.mailboxId}::text, ${input.threadId}::text
    )::text, 0))
  `);
  const current = await authorizeCollaborationThread(input, transaction);
  if (current.organizationId !== team.id) {
    throw new ORPCError("NOT_FOUND", {
      data: { resource: "mailbox" },
      message: "Conversation is not available.",
    });
  }
  return { actorMemberId: actor.id, mailbox: current };
};
