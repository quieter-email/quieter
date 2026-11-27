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
} from "@quieter/mail/mailbox-organization";
import type { LabelOrganizationAction } from "@quieter/mail/mailbox-organization";
import { and, eq } from "drizzle-orm";

import { publishMailboxChange } from "../mailbox-changes";
import { getAuthorizedManagedMailbox } from "../mailbox/access";
import { assertAccessibleMailbox } from "../mailbox/service";
import { appendManagedMailboxContentChange } from "../managed-mail/changes";

type MailboxActor = { mailboxId: string; userId: string };

export const getLabelOrganization = async (actor: MailboxActor) => {
  await assertAccessibleMailbox(actor);
  const [record] = await db
    .select({ organization: mailboxLabelOrganization.organization })
    .from(mailboxLabelOrganization)
    .where(eq(mailboxLabelOrganization.mailboxId, actor.mailboxId));
  return record?.organization ?? emptyLabelOrganization;
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
  const result = await db.transaction(async (tx) => {
    if (action.kind === "move-label") {
      const [label] = managed
        ? await tx
            .select({ id: managedMailLabel.id })
            .from(managedMailLabel)
            .where(
              and(
                eq(managedMailLabel.mailboxId, actor.mailboxId),
                eq(managedMailLabel.id, action.labelId)
              )
            )
        : await tx
            .select({ id: gmailLabel.labelId })
            .from(gmailLabel)
            .where(
              and(
                eq(gmailLabel.mailboxId, actor.mailboxId),
                eq(gmailLabel.labelId, action.labelId)
              )
            );
      if (label === undefined) {
        throw new ORPCError("NOT_FOUND", { message: "Label not found." });
      }
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
      action,
      randomUUID()
    );
    if (typeof organization === "string") {
      throw new ORPCError("BAD_REQUEST", { message: organization });
    }
    await tx
      .update(mailboxLabelOrganization)
      .set({ organization })
      .where(eq(mailboxLabelOrganization.mailboxId, actor.mailboxId));
    const committed = managed
      ? await appendManagedMailboxContentChange(tx, {
          changes: [{ kind: "mailbox.reconcile" }],
          mailboxId: actor.mailboxId,
        })
      : null;
    return { committed, organization };
  });
  await publishMailboxChange(result.committed);
  return result.organization;
};
