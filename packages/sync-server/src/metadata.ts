import {
  gmailLabel,
  managedMailSavedView,
  mailSyncEntity,
} from "@quieter/database/schema";
import { syncEntityDataSchema } from "@quieter/sync";
import { and, eq } from "drizzle-orm";

import type { SyncTransaction } from "./repository";

export const projectGmailLabelDetails = async (
  context: SyncTransaction,
  labelId: string
) => {
  const [label] = await context.database
    .select()
    .from(gmailLabel)
    .where(
      and(
        eq(gmailLabel.mailboxId, context.mailboxId),
        eq(gmailLabel.labelId, labelId)
      )
    );
  const [previous] = await context.database
    .select()
    .from(mailSyncEntity)
    .where(
      and(
        eq(mailSyncEntity.mailboxId, context.mailboxId),
        eq(mailSyncEntity.kind, "label"),
        eq(mailSyncEntity.entityId, labelId)
      )
    );
  context.put({
    data:
      label === undefined
        ? null
        : {
            kind: "label",
            value: {
              ...(previous?.data?.kind === "label"
                ? previous.data.value
                : { position: 0, type: "user", visible: true }),
              color: label.color,
              description: label.description,
              id: labelId,
              inclusionCriteria: label.inclusionCriteria,
              name: label.name,
            },
          },
    id: labelId,
    kind: "label",
  });
};

export const projectSavedViews = async (context: SyncTransaction) => {
  const views = await context.database
    .select()
    .from(managedMailSavedView)
    .where(eq(managedMailSavedView.mailboxId, context.mailboxId));
  const previous = await context.database
    .select({ id: mailSyncEntity.entityId })
    .from(mailSyncEntity)
    .where(
      and(
        eq(mailSyncEntity.mailboxId, context.mailboxId),
        eq(mailSyncEntity.kind, "saved-view")
      )
    );
  const ids = new Set(views.map((view) => view.id));
  for (const view of views) {
    context.put({
      data: syncEntityDataSchema.parse({
        kind: "saved-view",
        value: {
          ...view,
          createdAt: view.createdAt.toISOString(),
          updatedAt: view.updatedAt.toISOString(),
        },
      }),
      id: view.id,
      kind: "saved-view",
    });
  }
  for (const view of previous) {
    if (!ids.has(view.id)) {
      context.put({ data: null, id: view.id, kind: "saved-view" });
    }
  }
};
