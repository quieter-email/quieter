import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  managedMailLabel,
  managedMailMessage,
  managedMailMessageLabel,
  managedMailRule,
  managedMailSavedView,
  type ManagedMailMailboxState,
} from "@quieter/database/schema";
import { MAILBOX_LABELS } from "@quieter/gmail";
import { mailboxLabelColorSchema, type MailboxLabel } from "@quieter/mail/mailbox-organization";
import { structuredMailSearchSchema } from "@quieter/mail/search";
import { and, asc, countDistinct, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getAuthorizedManagedMailbox } from "../../mailbox/access";
import { getManagedMessageLabelIds } from "../messages/service";
import { normalizeManagedOrganizationName } from "../organization/normalize-name";
import {
  assertManagedLabelsBelongToMailbox,
  updateManagedMessageLabelAssignments,
} from "./repository";

const toMailboxLabel = (record: typeof managedMailLabel.$inferSelect): MailboxLabel => ({
  color: mailboxLabelColorSchema.parse(record.color),
  description: record.description,
  id: record.id,
  inclusionCriteria: null,
  name: record.name,
  position: record.position,
  provider: "managed",
  type: "user",
  visible: record.visible,
});

const MANAGED_SYSTEM_LABEL_IDS = new Set<string>(Object.values(MAILBOX_LABELS));

const getCustomLabelIds = (labelIds: string[] | undefined) =>
  labelIds?.filter((labelId) => !MANAGED_SYSTEM_LABEL_IDS.has(labelId));

const getMailboxStateFromLabelChanges = (input: {
  addLabelIds?: string[];
  removeLabelIds?: string[];
}): ManagedMailMailboxState | null => {
  const addLabelIds = new Set(input.addLabelIds ?? []);
  const removeLabelIds = new Set(input.removeLabelIds ?? []);

  if (addLabelIds.has(MAILBOX_LABELS.trash)) return "trash";
  if (addLabelIds.has(MAILBOX_LABELS.spam)) return "spam";
  if (
    addLabelIds.has(MAILBOX_LABELS.inbox) ||
    addLabelIds.has(MAILBOX_LABELS.sent) ||
    removeLabelIds.has(MAILBOX_LABELS.trash) ||
    removeLabelIds.has(MAILBOX_LABELS.spam)
  ) {
    return "active";
  }

  return null;
};

export const listManagedLabels = async (input: { mailboxId: string; userId: string }) => {
  await getAuthorizedManagedMailbox(input);
  const labels = await db
    .select()
    .from(managedMailLabel)
    .where(eq(managedMailLabel.mailboxId, input.mailboxId))
    .orderBy(asc(managedMailLabel.position), asc(managedMailLabel.name));
  return labels.map(toMailboxLabel);
};

export const listManagedLabelCounts = async (input: { mailboxId: string; userId: string }) => {
  await getAuthorizedManagedMailbox(input);
  return await db
    .select({
      count: countDistinct(managedMailMessage.threadId),
      labelId: managedMailMessageLabel.labelId,
    })
    .from(managedMailMessageLabel)
    .innerJoin(managedMailMessage, eq(managedMailMessage.id, managedMailMessageLabel.messageId))
    .where(eq(managedMailMessageLabel.mailboxId, input.mailboxId))
    .groupBy(managedMailMessageLabel.labelId);
};

export const createManagedLabel = async (input: {
  color: string;
  description?: string | null;
  mailboxId: string;
  name: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  const name = input.name.replace(/\s+/g, " ").trim();
  const now = new Date();
  const [record] = await db
    .insert(managedMailLabel)
    .values({
      color: mailboxLabelColorSchema.parse(input.color),
      createdAt: now,
      createdByUserId: input.userId,
      description: input.description?.trim() || null,
      id: randomUUID(),
      mailboxId: input.mailboxId,
      name,
      normalizedName: normalizeManagedOrganizationName(name),
      updatedAt: now,
      updatedByUserId: input.userId,
    })
    .returning();
  return toMailboxLabel(record);
};

export const updateManagedLabel = async (input: {
  color?: string;
  description?: string | null;
  labelId: string;
  mailboxId: string;
  name?: string;
  position?: number;
  userId: string;
  visible?: boolean;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  const name = input.name?.replace(/\s+/g, " ").trim();
  const [record] = await db
    .update(managedMailLabel)
    .set({
      ...(input.color ? { color: mailboxLabelColorSchema.parse(input.color) } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(name ? { name, normalizedName: normalizeManagedOrganizationName(name) } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.visible !== undefined ? { visible: input.visible } : {}),
      updatedAt: new Date(),
      updatedByUserId: input.userId,
    })
    .where(
      and(eq(managedMailLabel.id, input.labelId), eq(managedMailLabel.mailboxId, input.mailboxId)),
    )
    .returning();
  if (!record) throw new ORPCError("NOT_FOUND", { message: "Label not found." });
  return toMailboxLabel(record);
};

export const reorderManagedLabels = async (input: {
  labelIds: string[];
  mailboxId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  await assertManagedLabelsBelongToMailbox(input.mailboxId, input.labelIds);
  const now = new Date();
  await Promise.all(
    input.labelIds.map((labelId, position) =>
      db
        .update(managedMailLabel)
        .set({ position, updatedAt: now, updatedByUserId: input.userId })
        .where(
          and(eq(managedMailLabel.id, labelId), eq(managedMailLabel.mailboxId, input.mailboxId)),
        ),
    ),
  );
  return { labelIds: input.labelIds };
};

export const deleteManagedLabel = async (input: {
  labelId: string;
  mailboxId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  const [label] = await db
    .select({ id: managedMailLabel.id, name: managedMailLabel.name })
    .from(managedMailLabel)
    .where(
      and(eq(managedMailLabel.id, input.labelId), eq(managedMailLabel.mailboxId, input.mailboxId)),
    )
    .limit(1);
  if (!label) throw new ORPCError("NOT_FOUND", { message: "Label not found." });

  const [views, rules] = await Promise.all([
    db
      .select()
      .from(managedMailSavedView)
      .where(eq(managedMailSavedView.mailboxId, input.mailboxId)),
    db.select().from(managedMailRule).where(eq(managedMailRule.mailboxId, input.mailboxId)),
  ]);
  for (const view of views) {
    const search = structuredMailSearchSchema.parse(view.search);
    const nextFilters = search.filters.filter(
      (filter) =>
        !(
          filter.type === "label" &&
          normalizeManagedOrganizationName(filter.value) ===
            normalizeManagedOrganizationName(label.name)
        ),
    );
    if (nextFilters.length !== search.filters.length) {
      await db
        .update(managedMailSavedView)
        .set({
          disabledReason:
            nextFilters.length === 0 && !search.text ? "This view needs new filters." : null,
          search: { ...search, filters: nextFilters },
          updatedAt: new Date(),
        })
        .where(eq(managedMailSavedView.id, view.id));
    }
  }
  for (const rule of rules) {
    if (!rule.labelIds.includes(input.labelId)) continue;
    const labelIds = rule.labelIds.filter((labelId) => labelId !== input.labelId);
    await db
      .update(managedMailRule)
      .set({ enabled: labelIds.length > 0 && rule.enabled, labelIds, updatedAt: new Date() })
      .where(eq(managedMailRule.id, rule.id));
  }
  await db
    .delete(managedMailLabel)
    .where(
      and(eq(managedMailLabel.id, input.labelId), eq(managedMailLabel.mailboxId, input.mailboxId)),
    );
  return { id: input.labelId };
};

export const updateManagedThreadLabels = async (input: {
  addLabelIds?: string[];
  mailboxId: string;
  removeLabelIds?: string[];
  threadId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager", "responder"],
    userId: input.userId,
  });
  const messages = await db
    .select({
      direction: managedMailMessage.direction,
      id: managedMailMessage.id,
      isRead: managedMailMessage.isRead,
      mailboxState: managedMailMessage.mailboxState,
    })
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        eq(managedMailMessage.threadId, input.threadId),
      ),
    );
  if (messages.length === 0) {
    throw new ORPCError("NOT_FOUND", { message: "Message thread not found." });
  }
  const mailboxState = getMailboxStateFromLabelChanges(input);
  if (mailboxState) {
    await db
      .update(managedMailMessage)
      .set({ mailboxState, updatedAt: new Date() })
      .where(
        and(
          eq(managedMailMessage.mailboxId, input.mailboxId),
          eq(managedMailMessage.threadId, input.threadId),
        ),
      );
  }
  const updated = await updateManagedMessageLabelAssignments({
    ...input,
    addLabelIds: getCustomLabelIds(input.addLabelIds),
    messageIds: messages.map((message) => message.id),
    removeLabelIds: getCustomLabelIds(input.removeLabelIds),
    source: "manual",
  });
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  return {
    messages: updated.map((message) => {
      const record = messagesById.get(message.id);
      if (!record) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Message metadata is missing." });
      }
      return {
        ...message,
        isUnread: !record.isRead,
        labelIds: getManagedMessageLabelIds(
          { ...record, mailboxState: mailboxState ?? record.mailboxState },
          message.labelIds,
        ),
      };
    }),
    threadId: input.threadId,
  };
};

export const updateSingleManagedMessageLabels = async (input: {
  addLabelIds?: string[];
  mailboxId: string;
  messageId: string;
  removeLabelIds?: string[];
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager", "responder"],
    userId: input.userId,
  });
  const [message] = await db
    .select({
      direction: managedMailMessage.direction,
      id: managedMailMessage.id,
      isRead: managedMailMessage.isRead,
      mailboxState: managedMailMessage.mailboxState,
    })
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        eq(managedMailMessage.id, input.messageId),
      ),
    )
    .limit(1);
  if (!message) throw new ORPCError("NOT_FOUND", { message: "Message not found." });
  const mailboxState = getMailboxStateFromLabelChanges(input);
  if (mailboxState) {
    await db
      .update(managedMailMessage)
      .set({ mailboxState, updatedAt: new Date() })
      .where(
        and(
          eq(managedMailMessage.mailboxId, input.mailboxId),
          eq(managedMailMessage.id, input.messageId),
        ),
      );
  }
  const [updated] = await updateManagedMessageLabelAssignments({
    ...input,
    addLabelIds: getCustomLabelIds(input.addLabelIds),
    messageIds: [message.id],
    removeLabelIds: getCustomLabelIds(input.removeLabelIds),
    source: "manual",
  });
  return {
    ...updated,
    isUnread: !message.isRead,
    labelIds: getManagedMessageLabelIds(
      { ...message, mailboxState: mailboxState ?? message.mailboxState },
      updated.labelIds,
    ),
  };
};
