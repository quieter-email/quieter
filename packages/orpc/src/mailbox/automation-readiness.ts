import { db } from "@quieter/database/client";
import {
  aiMemoryMailboxState,
  aiMemoryScopeConfig,
  gmailComposeOperation,
  mailbox,
  mailboxAgentRun,
  mailMessageImportance,
  mailReminder,
  mailReminderJob,
  mailReminderSuggestion,
  userAiContextEvent,
} from "@quieter/database/schema";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import {
  AI_MEMORY_EVENT_LEASE_MS,
  BOOTSTRAP_LEASE_MS,
  SENT_REMINDER_RETRY_MS,
} from "./automation-timing";

type PendingSource = {
  from: SQL;
  mailboxId: AnyPgColumn;
  eligible: SQL;
  readyAt: SQL;
  withTimezone?: true;
  delayMs?: number;
};

const sources = {
  actions: [
    {
      eligible: sql`(${mailboxAgentRun.status} = 'queued' or (${mailboxAgentRun.status} = 'running' and ${mailboxAgentRun.leaseExpiresAt} is not null))`,
      from: sql`${mailboxAgentRun}`,
      mailboxId: mailboxAgentRun.mailboxId,
      readyAt: sql`coalesce(${mailboxAgentRun.leaseExpiresAt}, ${mailboxAgentRun.createdAt})`,
    },
  ],
  importance: [
    {
      eligible: sql`${mailMessageImportance.state} in ('pending', 'processing', 'paused', 'error')`,
      from: sql`${mailMessageImportance}`,
      mailboxId: mailMessageImportance.mailboxId,
      readyAt: sql`greatest(${mailMessageImportance.nextAttemptAt}, ${mailMessageImportance.leaseExpiresAt})`,
    },
  ],
  memory: [
    {
      delayMs: AI_MEMORY_EVENT_LEASE_MS,
      eligible: sql`${userAiContextEvent.mergedAt} is null and ${userAiContextEvent.skippedAt} is null and ${userAiContextEvent.metadata}->>'memoryScope' = 'user'`,
      from: sql`${userAiContextEvent}`,
      mailboxId: userAiContextEvent.mailboxId,
      readyAt: sql`greatest(${userAiContextEvent.updatedAt}, ${userAiContextEvent.processingAt})`,
    },
    {
      eligible: sql`
        ${mailbox.status} = 'connected'
        and ${aiMemoryMailboxState.status} in ('pending', 'processing', 'failed')
        and ${aiMemoryMailboxState.userId} is not null
        and (${aiMemoryMailboxState.status} <> 'processing' or ${aiMemoryMailboxState.processingAt} is not null)
        and not exists (
          select 1 from ${aiMemoryScopeConfig}
          where ${aiMemoryScopeConfig.scopeKey} = 'user:' || ${aiMemoryMailboxState.userId}
            and not ${aiMemoryScopeConfig.activeLearningEnabled}
        )
      `,
      from: sql`${aiMemoryMailboxState}`,
      mailboxId: aiMemoryMailboxState.mailboxId,
      readyAt: sql`case ${aiMemoryMailboxState.status}
        when 'pending' then ${aiMemoryMailboxState.updatedAt}
        when 'processing' then ${aiMemoryMailboxState.processingAt} + ${sql.raw(String(BOOTSTRAP_LEASE_MS))} * interval '1 millisecond'
        else ${aiMemoryMailboxState.updatedAt} + ${sql.raw(String(BOOTSTRAP_LEASE_MS))} * interval '1 millisecond'
      end`,
    },
  ],
  reminders: [
    {
      eligible: sql`${mailReminderJob.kind} = 'evaluate' and ${mailReminderJob.completedAt} is null`,
      from: sql`${mailReminderJob} inner join ${mailReminder} on ${mailReminder.id} = ${mailReminderJob.reminderId}`,
      mailboxId: mailReminder.mailboxId,
      readyAt: sql`greatest(${mailReminderJob.availableAt}, ${mailReminderJob.leaseUntil})`,
      withTimezone: true,
    },
    {
      eligible: sql`${mailReminderSuggestion.status} = 'pending'`,
      from: sql`${mailReminderSuggestion}`,
      mailboxId: mailReminderSuggestion.mailboxId,
      readyAt: sql`greatest(${mailReminderSuggestion.availableAt}, ${mailReminderSuggestion.leaseUntil})`,
      withTimezone: true,
    },
    {
      delayMs: SENT_REMINDER_RETRY_MS,
      eligible: sql`${gmailComposeOperation.kind} = 'send' and ${gmailComposeOperation.status} = 'accepted' and ${gmailComposeOperation.followUpReminder} is not null`,
      from: sql`${gmailComposeOperation}`,
      mailboxId: gmailComposeOperation.mailboxId,
      readyAt: sql`${gmailComposeOperation.updatedAt}`,
    },
  ],
} satisfies Record<string, PendingSource[]>;

export type GmailMailboxAutomationKind = keyof typeof sources;

const pendingGmailMailboxRows = (
  kind: GmailMailboxAutomationKind,
  scope: { mailboxId: string } | { now: Date }
) =>
  sql.join(
    sources[kind].map((source: PendingSource) => {
      const {
        delayMs = 0,
        eligible,
        from,
        mailboxId,
        readyAt,
        withTimezone,
      } = source;
      return sql`
        (select ${mailboxId} as "mailboxId",
          (extract(epoch from (${readyAt})) * 1000 + ${delayMs}::integer)::double precision as "wakeAt"
        from ${from}
        inner join ${mailbox} on ${mailbox.id} = ${mailboxId}
        where ${mailbox.provider} = 'gmail' and (${eligible})
          and ${
            "mailboxId" in scope
              ? sql`${mailboxId} = ${scope.mailboxId}`
              : sql`${readyAt} <= ${new Date(scope.now.getTime() - delayMs).toISOString()}::${withTimezone ? sql`timestamptz` : sql`timestamp`}`
          }
        ${"mailboxId" in scope ? sql`order by ${readyAt} limit 1` : sql.empty()}
        )
      `;
    }),
    sql` union all `
  );

export const getGmailMailboxAutomationWake = async (input: {
  kind: GmailMailboxAutomationKind;
  mailboxId: string;
}): Promise<{ nextWakeAt: number | null }> => {
  const [row] = await db.execute<{ nextWakeAt: number | null }>(sql`
    select min("wakeAt") as "nextWakeAt"
    from (${pendingGmailMailboxRows(input.kind, input)}) pending
  `);
  return { nextWakeAt: row?.nextWakeAt ?? null };
};

export const listDueGmailMailboxAutomation = async (input: {
  kind: GmailMailboxAutomationKind;
  limit?: number;
  now?: Date;
}) =>
  await db.execute<{ mailboxId: string; nextWakeAt: number }>(sql`
    select "mailboxId", min("wakeAt") as "nextWakeAt"
    from (${pendingGmailMailboxRows(input.kind, { now: input.now ?? new Date() })}) pending
    group by "mailboxId"
    order by "nextWakeAt", "mailboxId"
    limit ${Math.min(500, Math.max(1, input.limit ?? 50))}
  `);
