import { db } from "@quieter/database/client";
import type { DatabaseExecutor } from "@quieter/database/client";
import {
  gmailSchedulerEnrollment,
  mailbox,
  mailDispatchEvent,
} from "@quieter/database/schema";
import { mailDispatchEventSchema } from "@quieter/mail/dispatch";
import type { MailDispatchEvent } from "@quieter/mail/dispatch";
import { and, asc, eq, gt, sql } from "drizzle-orm";

export const enqueueMailDispatch = async (
  tx: DatabaseExecutor,
  event: MailDispatchEvent
) => {
  await tx.execute(
    sql`select enqueue_mail_dispatch_event(${JSON.stringify(mailDispatchEventSchema.parse(event))}::text::jsonb)`
  );
};

export const getMailDispatchEvent = async (eventId: string) => {
  const [stored] = await db
    .select({ payload: mailDispatchEvent.payload })
    .from(mailDispatchEvent)
    .where(eq(mailDispatchEvent.id, eventId));
  return stored === undefined
    ? null
    : mailDispatchEventSchema.parse(stored.payload);
};

export const completeMailDispatchEvent = async (eventId: string) => {
  await db.delete(mailDispatchEvent).where(eq(mailDispatchEvent.id, eventId));
};

export const enrollGmailDispatch = async () => {
  await db.transaction(async (tx) => {
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
