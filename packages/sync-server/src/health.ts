import type { DatabaseClient } from "@quieter/database/client";
import {
  mailSyncCommand,
  mailSyncOutbox,
  mailSyncSubmission,
} from "@quieter/database/schema";
import { count, eq, inArray, min } from "drizzle-orm";

export const readSyncHealth = async (
  database: DatabaseClient,
  now = Date.now()
) => {
  const [[outbox], [commands], [submissions]] = await Promise.all([
    database
      .select({ count: count(), oldest: min(mailSyncOutbox.createdAt) })
      .from(mailSyncOutbox),
    database
      .select({ count: count(), oldest: min(mailSyncCommand.createdAt) })
      .from(mailSyncCommand)
      .where(inArray(mailSyncCommand.status, ["accepted", "running"])),
    database
      .select({ count: count(), oldest: min(mailSyncSubmission.createdAt) })
      .from(mailSyncSubmission)
      .where(eq(mailSyncSubmission.status, "unknown")),
  ]);
  return {
    oldestCommandMs:
      commands.oldest === null
        ? 0
        : Math.max(0, now - commands.oldest.getTime()),
    oldestOutboxMs:
      outbox.oldest === null ? 0 : Math.max(0, now - outbox.oldest.getTime()),
    oldestUnknownSubmissionMs:
      submissions.oldest === null
        ? 0
        : Math.max(0, now - submissions.oldest.getTime()),
    pendingCommands: commands.count,
    pendingOutbox: outbox.count,
    unknownSubmissions: submissions.count,
  };
};
