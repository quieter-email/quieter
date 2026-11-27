import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  gmailLabel,
  mailboxLabelOrganization,
  managedMailLabel,
} from "@quieter/database/schema";
import {
  applyLabelOrganizationAction,
  emptyLabelOrganization,
  flattenLabelOrganization,
} from "@quieter/mail/mailbox-organization";
import type { LabelOrganizationAction } from "@quieter/mail/mailbox-organization";
import { and, eq, inArray } from "drizzle-orm";

import { getAuthorizedManagedMailbox } from "../mailbox/access";
import { assertAccessibleMailbox } from "../mailbox/service";

type MailboxActor = { mailboxId: string; userId: string };

export const getLabelOrganization = async (actor: MailboxActor) => {
  await assertAccessibleMailbox(actor);
  const [record] = await db
    .select({ organization: mailboxLabelOrganization.organization })
    .from(mailboxLabelOrganization)
    .where(eq(mailboxLabelOrganization.mailboxId, actor.mailboxId));
  return flattenLabelOrganization(
    record?.organization ?? emptyLabelOrganization
  );
};

export const updateLabelOrganization = async (
  actor: MailboxActor,
  action: LabelOrganizationAction
) => {
  const mailbox = await assertAccessibleMailbox(actor);
  const managed = mailbox.provider === "managed";
  if (managed) {
    await getAuthorizedManagedMailbox({ ...actor, requiredRoles: ["manager"] });
  }
  return await db.transaction(async (tx) => {
    let scopedAction = action;
    if (action.kind === "move-label") {
      const requestedIds = new Set([
        ...(action.labelOrder ?? []),
        action.labelId,
      ]);
      const beforeLabelId = action.beforeLabelId ?? null;
      if (beforeLabelId !== null) {
        requestedIds.add(beforeLabelId);
      }
      const labelIds = [...requestedIds];
      const matchingLabels = managed
        ? await tx
            .select({ id: managedMailLabel.id })
            .from(managedMailLabel)
            .where(
              and(
                eq(managedMailLabel.mailboxId, actor.mailboxId),
                inArray(managedMailLabel.id, labelIds)
              )
            )
        : await tx
            .select({ id: gmailLabel.labelId })
            .from(gmailLabel)
            .where(
              and(
                eq(gmailLabel.mailboxId, actor.mailboxId),
                inArray(gmailLabel.labelId, labelIds)
              )
            );
      const matchingIds = new Set(matchingLabels.map(({ id }) => id));
      if (!matchingIds.has(action.labelId)) {
        throw new ORPCError("NOT_FOUND", { message: "Label not found." });
      }
      if (beforeLabelId !== null && !matchingIds.has(beforeLabelId)) {
        throw new ORPCError("NOT_FOUND", {
          message: "Destination label not found.",
        });
      }
      scopedAction = {
        ...action,
        labelOrder: action.labelOrder?.filter((id) => matchingIds.has(id)),
      };
    }
    await tx
      .insert(mailboxLabelOrganization)
      .values({
        mailboxId: actor.mailboxId,
        organization: emptyLabelOrganization,
      })
      .onConflictDoNothing();
    const [record] = await tx
      .select({ organization: mailboxLabelOrganization.organization })
      .from(mailboxLabelOrganization)
      .where(eq(mailboxLabelOrganization.mailboxId, actor.mailboxId))
      .for("update");
    const organization = applyLabelOrganizationAction(
      record.organization,
      scopedAction,
      randomUUID()
    );
    if (typeof organization === "string") {
      throw new ORPCError("BAD_REQUEST", { message: organization });
    }
    await tx
      .update(mailboxLabelOrganization)
      .set({ organization })
      .where(eq(mailboxLabelOrganization.mailboxId, actor.mailboxId));
    return organization;
  });
};
