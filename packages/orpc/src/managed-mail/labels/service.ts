import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  managedMailLabel,
  mailbox,
  managedMailMessage,
  managedMailMessageLabel,
} from "@quieter/database/schema";
import type { ManagedMailMailboxState } from "@quieter/database/schema";
import { mailboxLabelColorSchema } from "@quieter/mail/mailbox-organization";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { MAILBOX_LABELS } from "@quieter/mail/messages";
import { and, asc, countDistinct, eq, sql } from "drizzle-orm";

import { withManagedSyncTransaction } from "../../mail-sync-runtime";
import { getAuthorizedManagedMailbox } from "../../mailbox/access";
import { getManagedMessageLabelIds } from "../messages/service";
import { throwMailboxOrganizationNameConflict } from "../organization/name-conflict";
import { normalizeManagedOrganizationName } from "../organization/normalize-name";
import { updateManagedLabelReferences } from "./references";
import {
  assertManagedLabelsBelongToMailbox,
  updateManagedMessageLabelAssignments,
} from "./repository";

const toMailboxLabel = (
  record: typeof managedMailLabel.$inferSelect
): MailboxLabel => ({
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
  const addLabelIds =
    input.addLabelIds === undefined
      ? new Set<string>()
      : new Set(input.addLabelIds);
  const removeLabelIds =
    input.removeLabelIds === undefined
      ? new Set<string>()
      : new Set(input.removeLabelIds);

  if (addLabelIds.has(MAILBOX_LABELS.trash)) {
    return "trash";
  }
  if (addLabelIds.has(MAILBOX_LABELS.spam)) {
    return "spam";
  }
  if (removeLabelIds.has(MAILBOX_LABELS.inbox)) {
    return "archived";
  }
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

export const listManagedLabels = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox(input);
  const labels = await db
    .select()
    .from(managedMailLabel)
    .where(eq(managedMailLabel.mailboxId, input.mailboxId))
    .orderBy(asc(managedMailLabel.position), asc(managedMailLabel.name));
  return labels.map(toMailboxLabel);
};

export const listManagedLabelCounts = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox(input);
  return await db
    .select({
      count: countDistinct(managedMailMessage.threadId),
      labelId: managedMailMessageLabel.labelId,
    })
    .from(managedMailMessageLabel)
    .innerJoin(
      managedMailMessage,
      eq(managedMailMessage.id, managedMailMessageLabel.messageId)
    )
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
  const name = input.name.replaceAll(/\s+/gu, " ").trim();
  const now = new Date();
  return await withManagedSyncTransaction(
    input.mailboxId,
    { labels: true },
    async (tx) => {
      const [record] = await tx
        .insert(managedMailLabel)
        .values({
          color: mailboxLabelColorSchema.parse(input.color),
          createdAt: now,
          createdByUserId: input.userId,
          description: input.description ? input.description.trim() : null,
          id: randomUUID(),
          mailboxId: input.mailboxId,
          name,
          normalizedName: normalizeManagedOrganizationName(name),
          updatedAt: now,
          updatedByUserId: input.userId,
        })
        .returning()
        .catch(throwMailboxOrganizationNameConflict);
      return toMailboxLabel(record);
    }
  );
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
  return await withManagedSyncTransaction(
    input.mailboxId,
    { labels: true },
    async (tx) => {
      const [label] = await tx
        .select()
        .from(managedMailLabel)
        .where(
          and(
            eq(managedMailLabel.id, input.labelId),
            eq(managedMailLabel.mailboxId, input.mailboxId)
          )
        )
        .for("update");
      if (label === undefined) {
        throw new ORPCError("NOT_FOUND", { message: "Label not found." });
      }
      const name = input.name?.replaceAll(/\s+/gu, " ").trim();
      const descriptionUpdate =
        input.description === undefined
          ? {}
          : {
              description: input.description ? input.description.trim() : null,
            };
      const [record] = await tx
        .update(managedMailLabel)
        .set({
          ...(input.color === undefined
            ? {}
            : { color: mailboxLabelColorSchema.parse(input.color) }),
          ...descriptionUpdate,
          ...(name
            ? { name, normalizedName: normalizeManagedOrganizationName(name) }
            : {}),
          ...(input.position === undefined ? {} : { position: input.position }),
          ...(input.visible === undefined ? {} : { visible: input.visible }),
          updatedAt: new Date(),
          updatedByUserId: input.userId,
        })
        .where(
          and(
            eq(managedMailLabel.id, input.labelId),
            eq(managedMailLabel.mailboxId, input.mailboxId)
          )
        )
        .returning()
        .catch(throwMailboxOrganizationNameConflict);
      if (record === undefined) {
        throw new ORPCError("NOT_FOUND", { message: "Label not found." });
      }
      if (name && name !== label.name) {
        await updateManagedLabelReferences(tx, label, false);
      }
      return toMailboxLabel(record);
    }
  );
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
  await withManagedSyncTransaction(
    input.mailboxId,
    { labels: true },
    async (tx) => {
      await Promise.all(
        input.labelIds.map((labelId, position) =>
          tx
            .update(managedMailLabel)
            .set({ position, updatedAt: now, updatedByUserId: input.userId })
            .where(
              and(
                eq(managedMailLabel.id, labelId),
                eq(managedMailLabel.mailboxId, input.mailboxId)
              )
            )
        )
      );
    }
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
  return await withManagedSyncTransaction(
    input.mailboxId,
    { labels: true },
    async (tx) => {
      const [label] = await tx
        .select()
        .from(managedMailLabel)
        .where(
          and(
            eq(managedMailLabel.id, input.labelId),
            eq(managedMailLabel.mailboxId, input.mailboxId)
          )
        )
        .for("update");
      if (label === undefined) {
        throw new ORPCError("NOT_FOUND", { message: "Label not found." });
      }
      await updateManagedLabelReferences(tx, label, true);
      await tx
        .delete(managedMailLabel)
        .where(eq(managedMailLabel.id, label.id));
      return { id: label.id };
    }
  );
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
        eq(managedMailMessage.threadId, input.threadId)
      )
    );
  if (messages.length === 0) {
    throw new ORPCError("NOT_FOUND", { message: "Message thread not found." });
  }
  const mailboxState = getMailboxStateFromLabelChanges(input);
  const updated = await withManagedSyncTransaction(
    input.mailboxId,
    { threadIds: [input.threadId] },
    async (tx) => {
      if (mailboxState) {
        await tx
          .update(managedMailMessage)
          .set({ mailboxState, updatedAt: new Date() })
          .where(
            and(
              eq(managedMailMessage.mailboxId, input.mailboxId),
              eq(managedMailMessage.threadId, input.threadId)
            )
          );
      }
      const assignments = await updateManagedMessageLabelAssignments({
        ...input,
        addLabelIds: getCustomLabelIds(input.addLabelIds),
        database: tx,
        messageIds: messages.map((message) => message.id),
        removeLabelIds: getCustomLabelIds(input.removeLabelIds),
        source: "manual",
      });
      await tx
        .update(mailbox)
        .set({
          contentRevision: sql`${mailbox.contentRevision} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(mailbox.id, input.mailboxId));
      return assignments;
    }
  );
  const messagesById = new Map(
    messages.map((message) => [message.id, message])
  );
  return {
    messages: updated.map((message) => {
      const record = messagesById.get(message.id);
      if (!record) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Message metadata is missing.",
        });
      }
      return {
        ...message,
        isUnread: !record.isRead,
        labelIds: getManagedMessageLabelIds(
          { ...record, mailboxState: mailboxState ?? record.mailboxState },
          message.labelIds
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
        eq(managedMailMessage.id, input.messageId)
      )
    )
    .limit(1);
  if (message === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Message not found." });
  }
  const mailboxState = getMailboxStateFromLabelChanges(input);
  const updated = await withManagedSyncTransaction(
    input.mailboxId,
    { messageIds: [input.messageId] },
    async (tx) => {
      if (mailboxState) {
        await tx
          .update(managedMailMessage)
          .set({ mailboxState, updatedAt: new Date() })
          .where(
            and(
              eq(managedMailMessage.mailboxId, input.mailboxId),
              eq(managedMailMessage.id, input.messageId)
            )
          );
      }
      const [assignment] = await updateManagedMessageLabelAssignments({
        ...input,
        addLabelIds: getCustomLabelIds(input.addLabelIds),
        database: tx,
        messageIds: [message.id],
        removeLabelIds: getCustomLabelIds(input.removeLabelIds),
        source: "manual",
      });
      await tx
        .update(mailbox)
        .set({
          contentRevision: sql`${mailbox.contentRevision} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(mailbox.id, input.mailboxId));
      return assignment;
    }
  );
  return {
    ...updated,
    isUnread: !message.isRead,
    labelIds: getManagedMessageLabelIds(
      { ...message, mailboxState: mailboxState ?? message.mailboxState },
      updated.labelIds
    ),
  };
};
