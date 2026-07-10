import type { GmailLabelListItem } from "@quieter/gmail";
import { db } from "@quieter/database/client";
import { gmailLabel } from "@quieter/database/schema";
import {
  mailboxLabelColorSchema,
  type MailboxLabelColor,
} from "@quieter/mail/mailbox-organization";
import { and, eq, notInArray, sql } from "drizzle-orm";

export type GmailLabelWithDetails = GmailLabelListItem & {
  color: MailboxLabelColor;
  description: string | null;
  inclusionCriteria: string | null;
};

export const syncGmailLabels = async (
  mailboxId: string,
  labels: GmailLabelListItem[],
): Promise<GmailLabelWithDetails[]> => {
  const userLabels = labels.filter((label) => label.type === "user");
  const now = new Date();

  if (userLabels.length > 0) {
    await db
      .insert(gmailLabel)
      .values(
        userLabels.map((label) => ({
          createdAt: now,
          color: "gray",
          labelId: label.id,
          mailboxId,
          name: label.name,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [gmailLabel.mailboxId, gmailLabel.labelId],
        set: {
          name: sql.raw('excluded."name"'),
          updatedAt: now,
        },
      });

    await db.delete(gmailLabel).where(
      and(
        eq(gmailLabel.mailboxId, mailboxId),
        notInArray(
          gmailLabel.labelId,
          userLabels.map((label) => label.id),
        ),
      ),
    );
  } else {
    await db.delete(gmailLabel).where(eq(gmailLabel.mailboxId, mailboxId));
  }

  const details = await db
    .select({
      color: gmailLabel.color,
      description: gmailLabel.description,
      inclusionCriteria: gmailLabel.inclusionCriteria,
      labelId: gmailLabel.labelId,
    })
    .from(gmailLabel)
    .where(eq(gmailLabel.mailboxId, mailboxId));
  const detailsByLabelId = new Map(details.map((detail) => [detail.labelId, detail]));

  return labels.map((label) => ({
    ...label,
    color: mailboxLabelColorSchema.parse(detailsByLabelId.get(label.id)?.color ?? "gray"),
    description: detailsByLabelId.get(label.id)?.description ?? null,
    inclusionCriteria: detailsByLabelId.get(label.id)?.inclusionCriteria ?? null,
  }));
};

export const saveGmailLabelDetails = async (input: {
  description: string | null;
  inclusionCriteria: string | null;
  labelId: string;
  mailboxId: string;
}) => {
  const [updatedLabel] = await db
    .update(gmailLabel)
    .set({
      description: input.description,
      inclusionCriteria: input.inclusionCriteria,
      updatedAt: new Date(),
    })
    .where(and(eq(gmailLabel.mailboxId, input.mailboxId), eq(gmailLabel.labelId, input.labelId)))
    .returning({
      description: gmailLabel.description,
      inclusionCriteria: gmailLabel.inclusionCriteria,
      labelId: gmailLabel.labelId,
    });

  return updatedLabel;
};

export const upsertSyncedGmailLabel = async (
  mailboxId: string,
  label: GmailLabelListItem,
  color?: MailboxLabelColor,
): Promise<GmailLabelWithDetails> => {
  const now = new Date();
  const [record] = await db
    .insert(gmailLabel)
    .values({
      createdAt: now,
      color: color ?? "gray",
      labelId: label.id,
      mailboxId,
      name: label.name,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [gmailLabel.mailboxId, gmailLabel.labelId],
      set: {
        ...(color ? { color } : {}),
        name: label.name,
        updatedAt: now,
      },
    })
    .returning({
      color: gmailLabel.color,
      description: gmailLabel.description,
      inclusionCriteria: gmailLabel.inclusionCriteria,
    });

  return {
    ...label,
    color: mailboxLabelColorSchema.parse(record?.color ?? "gray"),
    description: record?.description ?? null,
    inclusionCriteria: record?.inclusionCriteria ?? null,
  };
};

export const deleteSyncedGmailLabel = async (mailboxId: string, labelId: string) => {
  await db
    .delete(gmailLabel)
    .where(and(eq(gmailLabel.mailboxId, mailboxId), eq(gmailLabel.labelId, labelId)));
};
