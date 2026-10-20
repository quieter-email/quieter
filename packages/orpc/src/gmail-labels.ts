import { db } from "@quieter/database/client";
import { gmailLabel } from "@quieter/database/schema";
import type { AutoLabelSettings } from "@quieter/mail/auto-label";
import { mailboxLabelColorSchema } from "@quieter/mail/mailbox-organization";
import type { MailboxLabelColor } from "@quieter/mail/mailbox-organization";
import type { MailLabelListItem } from "@quieter/mail/messages";
import { and, eq, notInArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

export type GmailLabelWithDetails = MailLabelListItem & {
  autoLabel: AutoLabelSettings | null;
  color: MailboxLabelColor;
  description: string | null;
  inclusionCriteria: string | null;
};

export const syncGmailLabels = async (
  mailboxId: string,
  labels: MailLabelListItem[]
): Promise<GmailLabelWithDetails[]> => {
  const userLabels = labels.filter((label) => label.type === "user");
  const now = new Date();

  const details = await db.transaction(async (transaction) => {
    if (userLabels.length > 0) {
      await transaction
        .insert(gmailLabel)
        .values(
          userLabels.map((label) => ({
            color: "gray",
            createdAt: now,
            labelId: label.id,
            mailboxId,
            name: label.name,
            updatedAt: now,
          }))
        )
        .onConflictDoUpdate({
          set: {
            name: alias(gmailLabel, "excluded").name,
            updatedAt: now,
          },
          target: [gmailLabel.mailboxId, gmailLabel.labelId],
        });

      await transaction.delete(gmailLabel).where(
        and(
          eq(gmailLabel.mailboxId, mailboxId),
          notInArray(
            gmailLabel.labelId,
            userLabels.map((label) => label.id)
          )
        )
      );
    } else {
      await transaction
        .delete(gmailLabel)
        .where(eq(gmailLabel.mailboxId, mailboxId));
    }

    return await transaction
      .select({
        autoLabel: gmailLabel.autoLabel,
        color: gmailLabel.color,
        description: gmailLabel.description,
        inclusionCriteria: gmailLabel.inclusionCriteria,
        labelId: gmailLabel.labelId,
      })
      .from(gmailLabel)
      .where(eq(gmailLabel.mailboxId, mailboxId));
  });
  const detailsByLabelId = new Map(
    details.map((detail) => [detail.labelId, detail])
  );

  return labels.map((label) => ({
    ...label,
    autoLabel: detailsByLabelId.get(label.id)?.autoLabel ?? null,
    color: mailboxLabelColorSchema.parse(
      detailsByLabelId.get(label.id)?.color ?? "gray"
    ),
    description: detailsByLabelId.get(label.id)?.description ?? null,
    inclusionCriteria:
      detailsByLabelId.get(label.id)?.inclusionCriteria ?? null,
  }));
};

export const saveGmailLabelDetails = async (input: {
  autoLabel?: AutoLabelSettings | null;
  description: string | null;
  inclusionCriteria: string | null;
  labelId: string;
  mailboxId: string;
}) => {
  const [updatedLabel] = await db
    .update(gmailLabel)
    .set({
      ...(input.autoLabel === undefined ? {} : { autoLabel: input.autoLabel }),
      description: input.description,
      inclusionCriteria: input.inclusionCriteria,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(gmailLabel.mailboxId, input.mailboxId),
        eq(gmailLabel.labelId, input.labelId)
      )
    )
    .returning({
      autoLabel: gmailLabel.autoLabel,
      description: gmailLabel.description,
      inclusionCriteria: gmailLabel.inclusionCriteria,
      labelId: gmailLabel.labelId,
    });

  return updatedLabel;
};

export const upsertSyncedGmailLabel = async (
  mailboxId: string,
  label: MailLabelListItem,
  {
    autoLabel,
    color,
    description,
  }: {
    autoLabel?: AutoLabelSettings | null;
    color?: MailboxLabelColor;
    description?: string | null;
  } = {}
): Promise<GmailLabelWithDetails> => {
  const now = new Date();
  const [record] = await db
    .insert(gmailLabel)
    .values({
      autoLabel,
      color: color ?? "gray",
      createdAt: now,
      description,
      labelId: label.id,
      mailboxId,
      name: label.name,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: {
        ...(color ? { color } : {}),
        ...(autoLabel === undefined ? {} : { autoLabel }),
        ...(description === undefined ? {} : { description }),
        name: label.name,
        updatedAt: now,
      },
      target: [gmailLabel.mailboxId, gmailLabel.labelId],
    })
    .returning({
      autoLabel: gmailLabel.autoLabel,
      color: gmailLabel.color,
      description: gmailLabel.description,
      inclusionCriteria: gmailLabel.inclusionCriteria,
    });

  return {
    ...label,
    autoLabel: record?.autoLabel ?? null,
    color: mailboxLabelColorSchema.parse(record?.color ?? "gray"),
    description: record?.description ?? null,
    inclusionCriteria: record?.inclusionCriteria ?? null,
  };
};

export const deleteSyncedGmailLabel = async (
  mailboxId: string,
  labelId: string
) => {
  await db
    .delete(gmailLabel)
    .where(
      and(eq(gmailLabel.mailboxId, mailboxId), eq(gmailLabel.labelId, labelId))
    );
};
