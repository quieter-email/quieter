import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { gmailLabel } from "@quieter/database/schema";
import type { AutoLabelSettings } from "@quieter/mail/auto-label";
import { mailboxLabelColorSchema } from "@quieter/mail/mailbox-organization";
import type { MailboxLabelColor } from "@quieter/mail/mailbox-organization";
import type { MailLabelListItem } from "@quieter/mail/messages";
import { reportError } from "@quieter/observability";
import { and, eq, notInArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { assertMailEffectAllowed } from "./gmail-request";
import type { MailRequestContext } from "./gmail-request";

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
  context: MailRequestContext;
  autoLabel?: AutoLabelSettings | null;
  description: string | null;
  inclusionCriteria: string | null;
  labelId: string;
  mailboxId: string;
}) =>
  await db.transaction(async (transaction) => {
    await assertMailEffectAllowed(input.context, input.mailboxId, transaction, {
      providerWrite: false,
    });
    const [updatedLabel] = await transaction
      .update(gmailLabel)
      .set({
        ...(input.autoLabel === undefined
          ? {}
          : { autoLabel: input.autoLabel }),
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
  });

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
  },
  context: MailRequestContext
): Promise<GmailLabelWithDetails> => {
  const now = new Date();
  const [record] = await db
    .insert(gmailLabel)
    .values({
      createdAt: now,
      labelId: label.id,
      mailboxId,
      name: label.name,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: { name: label.name, updatedAt: now },
      target: [gmailLabel.mailboxId, gmailLabel.labelId],
    })
    .returning({
      autoLabel: gmailLabel.autoLabel,
      color: gmailLabel.color,
      description: gmailLabel.description,
      inclusionCriteria: gmailLabel.inclusionCriteria,
    });
  let details = record;
  if (
    autoLabel !== undefined ||
    color !== undefined ||
    description !== undefined
  ) {
    try {
      const [updated] = await db.transaction(async (transaction) => {
        await assertMailEffectAllowed(context, mailboxId, transaction, {
          providerWrite: false,
        });
        return await transaction
          .update(gmailLabel)
          .set({
            ...(autoLabel === undefined ? {} : { autoLabel }),
            ...(color === undefined ? {} : { color }),
            ...(description === undefined ? {} : { description }),
            updatedAt: now,
          })
          .where(
            and(
              eq(gmailLabel.mailboxId, mailboxId),
              eq(gmailLabel.labelId, label.id)
            )
          )
          .returning({
            autoLabel: gmailLabel.autoLabel,
            color: gmailLabel.color,
            description: gmailLabel.description,
            inclusionCriteria: gmailLabel.inclusionCriteria,
          });
      });
      details = updated ?? record;
    } catch (error) {
      if (!(error instanceof ORPCError) || error.status >= 500) {
        reportError(
          new Error(
            "The label was saved, but its details could not be updated."
          ),
          { operation: "mail:save-label-details" }
        );
      }
    }
  }
  return {
    ...label,
    autoLabel: details?.autoLabel ?? null,
    color: mailboxLabelColorSchema.parse(details?.color ?? "gray"),
    description: details?.description ?? null,
    inclusionCriteria: details?.inclusionCriteria ?? null,
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
