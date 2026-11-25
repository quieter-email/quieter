-- quieter:no-transaction
CREATE INDEX CONCURRENTLY "ai_memory_mailbox_state_automation_due_idx" ON "aiMemoryMailboxState" ((case "status"
        when 'pending' then "updatedAt"
        when 'processing' then "processingAt" + 300000 * interval '1 millisecond'
        else "updatedAt" + 300000 * interval '1 millisecond'
      end),"mailboxId") WHERE "status" in ('pending', 'processing', 'failed') and "userId" is not null;--> statement-breakpoint
CREATE INDEX CONCURRENTLY "gmail_compose_operation_follow_up_due_idx" ON "gmailComposeOperation" ("updatedAt","mailboxId") WHERE "kind" = 'send' and "status" = 'accepted' and "followUpReminder" is not null;--> statement-breakpoint
CREATE INDEX CONCURRENTLY "mail_importance_automation_due_idx" ON "mailMessageImportance" (greatest("nextAttemptAt", "leaseExpiresAt"),"mailboxId") WHERE "state" in ('pending', 'processing', 'paused', 'error');--> statement-breakpoint
CREATE INDEX CONCURRENTLY "mail_reminder_job_evaluate_due_idx" ON "mailReminderJob" (greatest("availableAt", "leaseUntil"),"reminderId") WHERE "kind" = 'evaluate' and "completedAt" is null;--> statement-breakpoint
CREATE INDEX CONCURRENTLY "mail_reminder_suggestion_automation_due_idx" ON "mailReminderSuggestion" (greatest("availableAt", "leaseUntil"),"mailboxId") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX CONCURRENTLY "mailbox_agent_run_automation_due_idx" ON "mailboxAgentRun" (coalesce("leaseExpiresAt", "createdAt"),"mailboxId") WHERE ("status" = 'queued' or ("status" = 'running' and "leaseExpiresAt" is not null));--> statement-breakpoint
CREATE INDEX CONCURRENTLY "user_ai_context_event_automation_due_idx" ON "userAiContextEvent" (greatest("updatedAt", "processingAt"),"mailboxId") WHERE "mergedAt" is null and "skippedAt" is null and "metadata"->>'memoryScope' = 'user';