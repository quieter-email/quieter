import { db } from "@quieter/database/client";
import {
  mailbox,
  mailReminder,
  scheduledMailSend,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { cleanupRateLimitBuckets } from "@quieter/orpc/abuse-protection";
import { purgeExpiredAiGeneratedMailBodies } from "@quieter/orpc/ai-mail-authorship";
import { processPendingAiMemoryEvents } from "@quieter/orpc/ai-memory";
import {
  processPendingMailMemoryBootstrap,
  seedMissingMailMemoryBootstrap,
} from "@quieter/orpc/ai-memory-capture";
import { backfillGmailCapturedBodies } from "@quieter/orpc/gmail-body-backfill";
import { cleanupGmailComposeOperations } from "@quieter/orpc/gmail-compose-retention";
import {
  drainMailAgentRuns,
  reportPendingMailAgentUsage,
} from "@quieter/orpc/mail-agent";
import {
  backfillMissingMailImportanceWork,
  processPendingMailImportance,
  reportPendingMailImportanceUsage,
} from "@quieter/orpc/mail-importance";
import { recoverMailSends } from "@quieter/orpc/mail-send";
import { retryPendingManagedVerificationCodes } from "@quieter/orpc/managed-mail/ingestion";
import { processManagedRuleBackfills } from "@quieter/orpc/managed-mail/rule-backfills";
import { cleanupMailObjects } from "@quieter/orpc/managed-mail/storage";
import {
  processReminderJobs,
  reportPendingReminderUsage,
  reportPendingReminderSuggestionUsage,
} from "@quieter/orpc/reminders/runtime";
import { requestReminderWake } from "@quieter/orpc/reminders/wake";
import { requestScheduledSendWake } from "@quieter/orpc/scheduled-send/wake";
import { processPendingSemanticIndexes } from "@quieter/orpc/semantic-index";
import { cleanupMailboxVerificationCodes } from "@quieter/orpc/verification-codes";
import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";

const globalTasks = [
  "send-recovery",
  "raw-object-cleanup",
  "rate-limit-retention",
  "generated-body-retention",
  "compose-retention",
  "code-retention",
  "managed-rules",
  "managed-codes",
  "agent-runs",
  "agent-usage",
  "importance",
  "importance-usage",
  "reminders",
  "reminder-usage",
  "memory-events",
  "memory-bootstrap",
  "semantic-index",
  "gmail-body-backfill",
  "bootstrap-scheduled-sends",
  "bootstrap-reminders",
  "bootstrap-importance",
  "bootstrap-memory",
] as const;

export const mailMaintenanceDispatchSchema = z
  .object({
    dueAt: z.number().int().nonnegative().max(8_640_000_000_000_000).optional(),
    scopeKey: z.string().min(1).max(512),
    task: z.enum([
      ...globalTasks,
      "scheduled-send",
      "reminder-clock",
      "memory-enroll",
    ]),
  })
  .refine(
    ({ scopeKey, task }) =>
      task === "scheduled-send" ||
      task === "reminder-clock" ||
      task === "memory-enroll" ||
      scopeKey === "global"
  );
export type MailMaintenanceDispatch = z.infer<
  typeof mailMaintenanceDispatchSchema
>;

export const mailMaintenanceBootstrap: MailMaintenanceDispatch[] =
  globalTasks.map((task) => ({ scopeKey: "global", task }));

const managed = { provider: "managed" } as const;
const wakePageSize = 20;

export const runMailMaintenance = async (
  { scopeKey, task }: MailMaintenanceDispatch,
  cursor: string | null
): Promise<{ nextWakeAt: number | null; cursor?: string }> => {
  const mailboxLanes = serverEnv.QUIETER_GMAIL_MAILBOX_LANES === true;
  const scope = mailboxLanes ? managed : {};
  const local = serverEnv.QUIETER_DEPLOYMENT_ENV === "local";
  switch (task) {
    case "scheduled-send":
    case "bootstrap-scheduled-sends": {
      let selection =
        cursor === null ? undefined : gt(scheduledMailSend.id, cursor);
      if (task === "scheduled-send") {
        selection = eq(scheduledMailSend.id, scopeKey);
      }
      const rows = await db
        .select({
          id: scheduledMailSend.id,
          mailboxId: scheduledMailSend.mailboxId,
          userId: scheduledMailSend.userId,
        })
        .from(scheduledMailSend)
        .where(and(isNotNull(scheduledMailSend.nextWakeAt), selection))
        .orderBy(scheduledMailSend.id)
        .limit(wakePageSize);
      for (const row of rows) {
        if (!(await requestScheduledSendWake(row))) {
          throw new Error("Could not register the scheduled send wake.");
        }
      }
      const last = rows.at(-1);
      return task === "bootstrap-scheduled-sends" &&
        rows.length === wakePageSize &&
        last
        ? { cursor: last.id, nextWakeAt: Date.now() }
        : { nextWakeAt: null };
    }
    case "reminder-clock":
    case "bootstrap-reminders": {
      const rows = await db
        .select({
          id: mailReminder.id,
          mailboxId: mailReminder.mailboxId,
          userId: mailReminder.userId,
        })
        .from(mailReminder)
        .where(
          and(
            eq(mailReminder.status, "active"),
            task === "reminder-clock"
              ? eq(mailReminder.id, scopeKey)
              : and(
                  cursor === null ? undefined : gt(mailReminder.id, cursor),
                  sql`(${isNull(mailReminder.firedAt)} or exists (
                  select 1 from "mailReminderJob" job
                  where job."reminderId" = ${mailReminder.id}
                    and job.kind in ('notify', 'schedule') and job."completedAt" is null
                ))`
                )
          )
        )
        .orderBy(mailReminder.id)
        .limit(wakePageSize);
      const scopes = new Map(
        rows.map((row) => [JSON.stringify([row.userId, row.mailboxId]), row])
      );
      for (const { mailboxId, userId } of scopes.values()) {
        if (!(await requestReminderWake({ mailboxId, userId }))) {
          throw new Error("Could not register the reminder wake.");
        }
      }
      const last = rows.at(-1);
      return task === "bootstrap-reminders" &&
        rows.length === wakePageSize &&
        last
        ? { cursor: last.id, nextWakeAt: Date.now() }
        : { nextWakeAt: null };
    }
    case "memory-enroll": {
      await seedMissingMailMemoryBootstrap({ mailboxId: scopeKey });
      return { nextWakeAt: null };
    }
    case "bootstrap-memory":
    case "bootstrap-importance": {
      const [box] = await db
        .select({ id: mailbox.id })
        .from(mailbox)
        .where(cursor === null ? undefined : gt(mailbox.id, cursor))
        .orderBy(mailbox.id)
        .limit(1);
      if (box === undefined) {
        return { nextWakeAt: null };
      }
      if (task === "bootstrap-memory") {
        await seedMissingMailMemoryBootstrap({ mailboxId: box.id });
      } else {
        const created = await backfillMissingMailImportanceWork({
          limit: 12,
          mailboxId: box.id,
        });
        if (created > 0) {
          return { nextWakeAt: Date.now() };
        }
      }
      return { cursor: box.id, nextWakeAt: Date.now() };
    }
    case "send-recovery": {
      await recoverMailSends();
      break;
    }
    case "raw-object-cleanup": {
      await cleanupMailObjects(new Date(), { parkReferenced: true });
      break;
    }
    case "rate-limit-retention": {
      await cleanupRateLimitBuckets();
      break;
    }
    case "generated-body-retention": {
      await purgeExpiredAiGeneratedMailBodies();
      break;
    }
    case "compose-retention": {
      await cleanupGmailComposeOperations();
      break;
    }
    case "code-retention": {
      await cleanupMailboxVerificationCodes();
      break;
    }
    case "managed-rules": {
      await processManagedRuleBackfills();
      break;
    }
    case "managed-codes": {
      await retryPendingManagedVerificationCodes();
      break;
    }
    case "agent-runs": {
      await drainMailAgentRuns({ concurrency: 2, limit: 8, ...scope });
      break;
    }
    case "agent-usage": {
      await reportPendingMailAgentUsage();
      break;
    }
    case "importance": {
      await processPendingMailImportance({
        backfill: false,
        limit: 10,
        ...scope,
      });
      break;
    }
    case "importance-usage": {
      await reportPendingMailImportanceUsage();
      break;
    }
    case "reminders": {
      await processReminderJobs({ limit: 4, ...scope });
      break;
    }
    case "reminder-usage": {
      await reportPendingReminderUsage();
      await reportPendingReminderSuggestionUsage();
      break;
    }
    case "memory-events": {
      if (local) {
        return { nextWakeAt: null };
      }
      await processPendingAiMemoryEvents({ limit: 8, ...scope });
      if (mailboxLanes) {
        await processPendingAiMemoryEvents({ limit: 8, unscopedOnly: true });
      }
      break;
    }
    case "memory-bootstrap": {
      if (local) {
        return { nextWakeAt: null };
      }
      await processPendingMailMemoryBootstrap({ seedMissing: false, ...scope });
      break;
    }
    case "semantic-index": {
      if (local) {
        return { nextWakeAt: null };
      }
      await processPendingSemanticIndexes({ eventDriven: true, ...scope });
      break;
    }
    case "gmail-body-backfill": {
      if (serverEnv.GMAIL_BODY_STORAGE_ENABLED !== true) {
        return { nextWakeAt: null };
      }
      await backfillGmailCapturedBodies();
      break;
    }
    default: {
      task satisfies never;
    }
  }

  const [next] = await db.execute<{ nextWakeAt: number | null }>(
    sql`select mail_maintenance_next_wake(${task}, ${mailboxLanes}) as "nextWakeAt"`
  );
  const readyAt = next?.nextWakeAt ?? null;
  const delay =
    task === "send-recovery" ||
    task === "managed-codes" ||
    task.endsWith("-usage")
      ? 30_000
      : 1000;
  return {
    nextWakeAt: readyAt === null ? null : Math.max(Date.now() + delay, readyAt),
  };
};
