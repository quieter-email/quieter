import { db } from "@quieter/database/client";
import type { DatabaseExecutor } from "@quieter/database/client";
import {
  gmailSchedulerEnrollment,
  mailbox,
  mailDispatchEvent,
  mailDispatchSettings,
} from "@quieter/database/schema";
import {
  MAIL_DISPATCH_BATCH_SIZE,
  mailDispatchEventSchema,
} from "@quieter/mail/dispatch";
import type { MailDispatchEvent } from "@quieter/mail/dispatch";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

export const enqueueMailDispatch = async (
  tx: DatabaseExecutor,
  event: MailDispatchEvent
) => {
  const [outcome] = await tx.execute<{ queued: boolean }>(
    sql`select enqueue_mail_dispatch_event(${JSON.stringify(mailDispatchEventSchema.parse(event))}::text::jsonb) as queued`
  );
  return outcome?.queued;
};

export const claimMailDispatchEvents = async (
  scope: { eventIds: string[] } | { shard: number }
) => {
  const now = sql`timezone('UTC', now())`;
  const dueAt = sql`coalesce(${mailDispatchEvent.dispatchAfter}, ${mailDispatchEvent.createdAt})`;
  const claimed = db.$with("claimed").as(
    db
      .select({ id: mailDispatchEvent.id })
      .from(mailDispatchEvent)
      .where(
        and(
          "eventIds" in scope
            ? inArray(mailDispatchEvent.id, scope.eventIds)
            : eq(mailDispatchEvent.shard, scope.shard),
          sql`${dueAt} <= ${now}`
        )
      )
      .orderBy(asc(dueAt), asc(mailDispatchEvent.id))
      .limit(MAIL_DISPATCH_BATCH_SIZE)
      .for("update", { skipLocked: true })
  );
  return await db
    .with(claimed)
    .update(mailDispatchEvent)
    .set({ dispatchAfter: sql`${now} + interval '2 minutes'` })
    .where(
      inArray(mailDispatchEvent.id, db.select({ id: claimed.id }).from(claimed))
    )
    .returning({
      id: mailDispatchEvent.id,
      payload: mailDispatchEvent.payload,
    });
};

export const completeMailDispatchEvents = async (eventIds: string[]) => {
  if (eventIds.length > 0) {
    await db
      .delete(mailDispatchEvent)
      .where(inArray(mailDispatchEvent.id, eventIds));
  }
};

export const enrollGmailDispatch = async () => {
  await db.transaction(async (tx) => {
    const [settings] = await tx
      .select({ enabled: mailDispatchSettings.enabled })
      .from(mailDispatchSettings)
      .where(eq(mailDispatchSettings.key, "mail-dispatch-v1"))
      .for("share");
    if (!settings?.enabled) {
      return;
    }
    const key = "gmail-mail-dispatch-v1";
    await tx
      .insert(gmailSchedulerEnrollment)
      .values({ key })
      .onConflictDoNothing();
    const [progress] = await tx
      .select()
      .from(gmailSchedulerEnrollment)
      .where(eq(gmailSchedulerEnrollment.key, key))
      .for("update");
    if (progress === undefined || progress.completedAt !== null) {
      return;
    }
    const limit = 100;
    const page = await tx
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(
        and(
          eq(mailbox.provider, "gmail"),
          eq(mailbox.status, "connected"),
          progress.afterMailboxId === null
            ? undefined
            : gt(mailbox.id, progress.afterMailboxId)
        )
      )
      .orderBy(asc(mailbox.id))
      .limit(limit);
    if (page.length > 0) {
      await tx.execute(sql`
        select enqueue_mail_dispatch_event(jsonb_build_object(
          'kind','gmail','mailboxId', mailbox_id, 'tasks',jsonb_build_array('sync')
        ))
        from jsonb_array_elements_text(${JSON.stringify(page.map(({ id }) => id))}::text::jsonb)
        as mailbox_ids(mailbox_id)
      `);
    }
    const more = page.length === limit;
    await tx
      .update(gmailSchedulerEnrollment)
      .set({
        afterMailboxId: page.at(-1)?.id ?? progress.afterMailboxId,
        completedAt: more ? null : new Date(),
      })
      .where(eq(gmailSchedulerEnrollment.key, key));
    if (more) {
      await enqueueMailDispatch(tx, { kind: "gmail-enrollment" });
    }
  });
};
