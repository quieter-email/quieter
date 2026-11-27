import { db } from "@quieter/database/client";
import { mailCommandReceipt } from "@quieter/database/schema";
import { and, isNull, lt, or, sql } from "drizzle-orm";

const RETENTION_BATCH_SIZE = 1000;

export const cleanupMailCommandReceipts = async (now = new Date()) => {
  const expired = db.$with("expired_receipts").as(
    db
      .select({
        actorUserId: mailCommandReceipt.actorUserId,
        mailboxId: mailCommandReceipt.mailboxId,
        requestId: mailCommandReceipt.requestId,
      })
      .from(mailCommandReceipt)
      .where(
        and(
          or(
            lt(
              mailCommandReceipt.createdAt,
              new Date(now.getTime() - 30 * 24 * 60 * 60_000)
            ),
            and(
              isNull(mailCommandReceipt.createdAt),
              isNull(mailCommandReceipt.claimedAt)
            ),
            and(
              isNull(mailCommandReceipt.createdAt),
              lt(
                mailCommandReceipt.claimedAt,
                new Date(now.getTime() - 30 * 24 * 60 * 60_000)
              )
            )
          ),
          or(
            isNull(mailCommandReceipt.claimedAt),
            lt(
              mailCommandReceipt.claimedAt,
              new Date(now.getTime() - 60 * 60_000)
            )
          )
        )
      )
      .orderBy(mailCommandReceipt.createdAt)
      .limit(RETENTION_BATCH_SIZE)
      .for("update", { skipLocked: true })
  );
  const removed = await db
    .with(expired)
    .delete(mailCommandReceipt)
    .where(sql`
    (${mailCommandReceipt.actorUserId}, ${mailCommandReceipt.mailboxId}, ${mailCommandReceipt.requestId})
    in (select ${expired.actorUserId}, ${expired.mailboxId}, ${expired.requestId} from ${expired})
  `)
    .returning({ requestId: mailCommandReceipt.requestId });
  return removed.length === RETENTION_BATCH_SIZE;
};
