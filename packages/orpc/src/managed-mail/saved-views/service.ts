import { ORPCError } from "@orpc/server";
import { db, managedMailSavedView } from "@quieter/database";
import { mailboxSavedViewDefinitionSchema, type MailboxSavedViewDefinition } from "@quieter/mail";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getAuthorizedManagedMailbox } from "../../mailbox/access";
import { normalizeManagedOrganizationName } from "../organization/normalize-name";

const assertViewAccess = async (input: {
  mailboxId: string;
  ownerUserId: string | null;
  userId: string;
}) => {
  const mailbox = await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    userId: input.userId,
  });
  if (input.ownerUserId === null && mailbox.role !== "manager") {
    throw new ORPCError("FORBIDDEN", { message: "Mailbox manager access is required." });
  }
  if (input.ownerUserId !== null && input.ownerUserId !== input.userId) {
    throw new ORPCError("FORBIDDEN", { message: "This personal view belongs to another user." });
  }
};

export const listManagedSavedViews = async (input: { mailboxId: string; userId: string }) => {
  await getAuthorizedManagedMailbox(input);
  return await db
    .select()
    .from(managedMailSavedView)
    .where(
      and(
        eq(managedMailSavedView.mailboxId, input.mailboxId),
        or(
          isNull(managedMailSavedView.ownerUserId),
          eq(managedMailSavedView.ownerUserId, input.userId),
        ),
      ),
    )
    .orderBy(asc(managedMailSavedView.ownerUserId), asc(managedMailSavedView.position));
};

export const createManagedSavedView = async (input: {
  definition: MailboxSavedViewDefinition;
  mailboxId: string;
  shared: boolean;
  userId: string;
}) => {
  const definition = mailboxSavedViewDefinitionSchema.parse(input.definition);
  await assertViewAccess({
    mailboxId: input.mailboxId,
    ownerUserId: input.shared ? null : input.userId,
    userId: input.userId,
  });
  const now = new Date();
  const [record] = await db
    .insert(managedMailSavedView)
    .values({
      color: definition.color,
      createdAt: now,
      icon: definition.icon,
      id: randomUUID(),
      mailboxId: input.mailboxId,
      name: definition.name,
      normalizedName: normalizeManagedOrganizationName(definition.name),
      ownerUserId: input.shared ? null : input.userId,
      search: definition.search,
      sort: definition.sort,
      updatedAt: now,
    })
    .returning();
  return record;
};

export const updateManagedSavedView = async (input: {
  definition: MailboxSavedViewDefinition;
  mailboxId: string;
  userId: string;
  viewId: string;
}) => {
  const definition = mailboxSavedViewDefinitionSchema.parse(input.definition);
  const [view] = await db
    .select()
    .from(managedMailSavedView)
    .where(
      and(
        eq(managedMailSavedView.id, input.viewId),
        eq(managedMailSavedView.mailboxId, input.mailboxId),
      ),
    )
    .limit(1);
  if (!view) throw new ORPCError("NOT_FOUND", { message: "Saved view not found." });
  await assertViewAccess({
    mailboxId: input.mailboxId,
    ownerUserId: view.ownerUserId,
    userId: input.userId,
  });
  const [updated] = await db
    .update(managedMailSavedView)
    .set({
      color: definition.color,
      disabledReason: null,
      icon: definition.icon,
      name: definition.name,
      normalizedName: normalizeManagedOrganizationName(definition.name),
      search: definition.search,
      sort: definition.sort,
      updatedAt: new Date(),
    })
    .where(eq(managedMailSavedView.id, view.id))
    .returning();
  return updated;
};

export const deleteManagedSavedView = async (input: {
  mailboxId: string;
  userId: string;
  viewId: string;
}) => {
  const [view] = await db
    .select()
    .from(managedMailSavedView)
    .where(
      and(
        eq(managedMailSavedView.id, input.viewId),
        eq(managedMailSavedView.mailboxId, input.mailboxId),
      ),
    )
    .limit(1);
  if (!view) throw new ORPCError("NOT_FOUND", { message: "Saved view not found." });
  await assertViewAccess({
    mailboxId: input.mailboxId,
    ownerUserId: view.ownerUserId,
    userId: input.userId,
  });
  await db.delete(managedMailSavedView).where(eq(managedMailSavedView.id, view.id));
  return { id: view.id };
};

export const reorderManagedSavedViews = async (input: {
  mailboxId: string;
  userId: string;
  viewIds: string[];
}) => {
  const views =
    input.viewIds.length > 0
      ? await db
          .select()
          .from(managedMailSavedView)
          .where(
            and(
              eq(managedMailSavedView.mailboxId, input.mailboxId),
              inArray(managedMailSavedView.id, input.viewIds),
            ),
          )
      : [];
  if (views.length !== new Set(input.viewIds).size) {
    throw new ORPCError("BAD_REQUEST", { message: "One or more saved views are unavailable." });
  }
  for (const view of views) {
    await assertViewAccess({
      mailboxId: input.mailboxId,
      ownerUserId: view.ownerUserId,
      userId: input.userId,
    });
  }
  await Promise.all(
    input.viewIds.map((viewId, position) =>
      db
        .update(managedMailSavedView)
        .set({ position, updatedAt: new Date() })
        .where(eq(managedMailSavedView.id, viewId)),
    ),
  );
  return { viewIds: input.viewIds };
};
