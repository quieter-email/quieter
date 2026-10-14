import { db } from "@quieter/database/client";
import { gmailComposeOperation } from "@quieter/database/schema";
import {
  and,
  eq,
  exists,
  gt,
  inArray,
  lt,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

export const cleanupGmailComposeOperations = async () => {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const successor = alias(gmailComposeOperation, "composeSuccessor");
  const lock = alias(gmailComposeOperation, "composeActiveLock");
  // Send and first-save receipts are permanent dedupe evidence for late retries.
  const removed = await db
    .delete(gmailComposeOperation)
    .where(
      inArray(
        gmailComposeOperation.id,
        db
          .select({ id: gmailComposeOperation.id })
          .from(gmailComposeOperation)
          .where(
            and(
              lt(gmailComposeOperation.updatedAt, cutoff),
              or(
                eq(gmailComposeOperation.status, "rejected"),
                and(
                  eq(gmailComposeOperation.status, "accepted"),
                  or(
                    sql`${gmailComposeOperation.operationKey} like 'lock:%'`,
                    and(
                      eq(gmailComposeOperation.kind, "save"),
                      sql`${gmailComposeOperation.operationKey} like 'save:%'`,
                      sql`${gmailComposeOperation.operationKey} not like 'save:create:%'`,
                      exists(
                        db
                          .select({ id: successor.id })
                          .from(successor)
                          .where(
                            and(
                              eq(
                                successor.mailboxId,
                                gmailComposeOperation.mailboxId
                              ),
                              eq(
                                successor.draftId,
                                gmailComposeOperation.draftId
                              ),
                              eq(successor.kind, "save"),
                              eq(successor.status, "accepted"),
                              gt(
                                successor.createdAt,
                                gmailComposeOperation.createdAt
                              )
                            )
                          )
                      )
                    )
                  )
                )
              ),
              notExists(
                db
                  .select({ id: lock.id })
                  .from(lock)
                  .where(
                    and(
                      eq(lock.mailboxId, gmailComposeOperation.mailboxId),
                      sql`${lock.operationKey} like 'lock:%'`,
                      inArray(lock.status, ["submitting", "unknown"])
                    )
                  )
              )
            )
          )
          .orderBy(gmailComposeOperation.updatedAt)
          .limit(1000)
          .for("update", { skipLocked: true })
      )
    )
    .returning({ id: gmailComposeOperation.id });
  return { deleted: removed.length };
};
