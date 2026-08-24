import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import type { MailboxGrantRole } from "@quieter/database/schema";
import { mailbox, managedMailSavedView } from "@quieter/database/schema";
import { mailboxSavedViewDefinitionSchema } from "@quieter/mail/mailbox-organization";
import type { MailboxSavedViewDefinition } from "@quieter/mail/mailbox-organization";
import { isMailSearchFilterSupported } from "@quieter/mail/search";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";

import {
  getAuthorizedManagedMailbox,
  MAILBOX_PROVIDER_GMAIL,
  MAILBOX_PROVIDER_MANAGED,
} from "../mailbox/access";
import { normalizeManagedOrganizationName } from "../managed-mail/organization/normalize-name";

type SavedViewProvider = "gmail" | "managed";

export type SavedViewMailboxContext = {
  provider: SavedViewProvider;
  role: MailboxGrantRole | null;
};

const resolveSavedViewMailboxContext = async (input: {
  mailboxId: string;
  userId: string;
}): Promise<SavedViewMailboxContext> => {
  const [record] = await db
    .select({ ownerUserId: mailbox.ownerUserId, provider: mailbox.provider })
    .from(mailbox)
    .where(eq(mailbox.id, input.mailboxId))
    .limit(1);
  if (
    record === undefined ||
    (record.provider === MAILBOX_PROVIDER_GMAIL &&
      record.ownerUserId !== input.userId)
  ) {
    throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
  }
  if (record.provider === MAILBOX_PROVIDER_MANAGED) {
    const authorizedMailbox = await getAuthorizedManagedMailbox(input);
    return { provider: MAILBOX_PROVIDER_MANAGED, role: authorizedMailbox.role };
  }
  return { provider: MAILBOX_PROVIDER_GMAIL, role: null };
};

const assertViewAccess = (input: {
  context: SavedViewMailboxContext;
  ownerUserId: string | null;
  userId: string;
}) => {
  if (
    input.context.provider === MAILBOX_PROVIDER_MANAGED &&
    input.ownerUserId === null &&
    input.context.role !== "manager"
  ) {
    throw new ORPCError("FORBIDDEN", {
      message: "Mailbox manager access is required.",
    });
  }
  if (input.ownerUserId !== null && input.ownerUserId !== input.userId) {
    throw new ORPCError("FORBIDDEN", {
      message: "This personal view belongs to another user.",
    });
  }
};

export const resolveSavedViewOwnerUserId = (input: {
  context: SavedViewMailboxContext;
  shared: boolean;
  userId: string;
}): string | null => {
  if (input.context.provider === MAILBOX_PROVIDER_GMAIL && input.shared) {
    throw new ORPCError("FORBIDDEN", {
      message: "Shared views are unavailable for personal mailboxes.",
    });
  }
  const ownerUserId = input.shared ? null : input.userId;
  assertViewAccess({
    context: input.context,
    ownerUserId,
    userId: input.userId,
  });
  return ownerUserId;
};

export const assertSavedViewRowAccess = (input: {
  context: SavedViewMailboxContext;
  userId: string;
  viewOwnerUserId: string | null;
}) => {
  assertViewAccess({
    context: input.context,
    ownerUserId: input.viewOwnerUserId,
    userId: input.userId,
  });
};

export const assertSavedViewDefinitionSupported = (input: {
  definition: MailboxSavedViewDefinition;
  provider: SavedViewProvider;
}) => {
  const hasUnsupportedFilter = input.definition.search.filters.some(
    (filter) => !isMailSearchFilterSupported(input.provider, filter)
  );
  if (hasUnsupportedFilter) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "This saved view uses search filters that are unavailable for this mailbox.",
    });
  }
};

export const listSavedViews = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  await resolveSavedViewMailboxContext(input);
  return await db
    .select()
    .from(managedMailSavedView)
    .where(
      and(
        eq(managedMailSavedView.mailboxId, input.mailboxId),
        or(
          isNull(managedMailSavedView.ownerUserId),
          eq(managedMailSavedView.ownerUserId, input.userId)
        )
      )
    )
    .orderBy(
      asc(managedMailSavedView.ownerUserId),
      asc(managedMailSavedView.position)
    );
};

export const createSavedView = async (input: {
  definition: MailboxSavedViewDefinition;
  mailboxId: string;
  shared: boolean;
  userId: string;
}) => {
  const definition = mailboxSavedViewDefinitionSchema.parse(input.definition);
  const context = await resolveSavedViewMailboxContext(input);
  const ownerUserId = resolveSavedViewOwnerUserId({
    context,
    shared: input.shared,
    userId: input.userId,
  });
  assertSavedViewDefinitionSupported({
    definition,
    provider: context.provider,
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
      ownerUserId,
      search: definition.search,
      sort: definition.sort,
      updatedAt: now,
    })
    .returning();
  return record;
};

export const updateSavedView = async (input: {
  definition: MailboxSavedViewDefinition;
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
        eq(managedMailSavedView.mailboxId, input.mailboxId)
      )
    )
    .limit(1);
  if (view === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Saved view not found." });
  }
  const context = await resolveSavedViewMailboxContext(input);
  assertSavedViewRowAccess({
    context,
    userId: input.userId,
    viewOwnerUserId: view.ownerUserId,
  });
  const definition = mailboxSavedViewDefinitionSchema.parse(input.definition);
  assertSavedViewDefinitionSupported({
    definition,
    provider: context.provider,
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

export const deleteSavedView = async (input: {
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
        eq(managedMailSavedView.mailboxId, input.mailboxId)
      )
    )
    .limit(1);
  if (view === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Saved view not found." });
  }
  const context = await resolveSavedViewMailboxContext(input);
  assertSavedViewRowAccess({
    context,
    userId: input.userId,
    viewOwnerUserId: view.ownerUserId,
  });
  await db
    .delete(managedMailSavedView)
    .where(eq(managedMailSavedView.id, view.id));
  return { id: view.id };
};

export const reorderSavedViews = async (input: {
  mailboxId: string;
  userId: string;
  viewIds: string[];
}) => {
  const context = await resolveSavedViewMailboxContext(input);
  const views =
    input.viewIds.length > 0
      ? await db
          .select()
          .from(managedMailSavedView)
          .where(
            and(
              eq(managedMailSavedView.mailboxId, input.mailboxId),
              inArray(managedMailSavedView.id, input.viewIds)
            )
          )
      : [];
  if (views.length !== input.viewIds.length) {
    throw new ORPCError("BAD_REQUEST", {
      message: "One or more saved views are unavailable.",
    });
  }
  for (const view of views) {
    assertSavedViewRowAccess({
      context,
      userId: input.userId,
      viewOwnerUserId: view.ownerUserId,
    });
  }
  await Promise.all(
    input.viewIds.map((viewId, position) =>
      db
        .update(managedMailSavedView)
        .set({ position, updatedAt: new Date() })
        .where(eq(managedMailSavedView.id, viewId))
    )
  );
  return { viewIds: input.viewIds };
};
