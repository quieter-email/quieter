import { ORPCError } from "@orpc/server";
import type { AiUsageReport } from "@quieter/ai/chat-usage";
import { isAiCreditAdmissionBusy } from "@quieter/ai/errors";
import { resolveBackgroundModel } from "@quieter/ai/model-config";
import { evaluateReminderCondition } from "@quieter/ai/reminders";
import { reportAiUsage } from "@quieter/billing";
import { createMailboxAiBillingContext } from "@quieter/billing/ai-reservation";
import { db } from "@quieter/database/client";
import {
  mailReminder,
  mailReminderJob,
  gmailComposeOperation,
  mailbox,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { extractMailAddress } from "@quieter/mail/compose/schema";
import { reportError } from "@quieter/observability";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { convert } from "html-to-text";

import { assertCanUseAi } from "../ai-access";
import { getMailAutomationAiBudgetStatus } from "../mail-automation/ai-budget";
import { publishMailUpdate } from "../mail-updates";
import { queriesMailOperations } from "../mail/queries";
import { assertReminderScopeAccess } from "./clock";
import { claimReminderJob, finishReminderJob } from "./persistence";
import { materializeSentReminder } from "./sent";
import { processReminderSuggestions } from "./suggestions";

export { advanceReminderScope, reconcileReminderSchedules } from "./clock";

const applyReminderEvaluation = async (input: {
  jobId: string;
  token: string;
  reminderId: string;
  version: number;
  status: "unfulfilled" | "uncertain" | "fulfilled" | "failed";
  summary: string;
}) => {
  const changed = await db.transaction(async (tx) => {
    const [lease] = await tx
      .select()
      .from(mailReminderJob)
      .where(
        and(
          eq(mailReminderJob.id, input.jobId),
          eq(mailReminderJob.leaseToken, input.token),
          sql`${mailReminderJob.leaseUntil} > now()`
        )
      )
      .for("update");
    if (lease === undefined) {
      return null;
    }
    const [updated] = await tx
      .update(mailReminder)
      .set({
        evaluationStatus: input.status,
        evaluationSummary: input.summary,
        updatedAt: new Date(),
        ...(input.status === "fulfilled"
          ? {
              resolution: "fulfilled",
              status: "completed",
              version: input.version + 1,
            }
          : {}),
      })
      .where(
        and(
          eq(mailReminder.id, input.reminderId),
          eq(mailReminder.version, input.version),
          eq(mailReminder.status, "active")
        )
      )
      .returning({
        id: mailReminder.id,
        mailboxId: mailReminder.mailboxId,
        scheduleVersion: mailReminder.scheduleVersion,
        userId: mailReminder.userId,
      });
    return updated ?? null;
  });
  if (changed === null) {
    return false;
  }
  await publishMailUpdate(
    {
      mailboxId: changed.mailboxId,
      reminderId: changed.id,
      scheduleVersion: changed.scheduleVersion,
      type: "reminders.changed",
    },
    { recipientUserIds: [changed.userId] }
  );
  return true;
};

const reportPendingReminderUsage = async () => {
  const rows = await db
    .select({ job: mailReminderJob, reminder: mailReminder })
    .from(mailReminderJob)
    .innerJoin(mailReminder, eq(mailReminder.id, mailReminderJob.reminderId))
    .where(
      and(
        isNotNull(mailReminderJob.usage),
        isNull(mailReminderJob.usageReportedAt)
      )
    )
    .limit(50);
  for (const { job, reminder } of rows) {
    if (!job.usage || !job.usageModel) {
      continue;
    }
    try {
      await reportAiUsage({
        ...job.usage,
        costUsd: job.usage.costUsd,
        externalId: `reminder:${job.id}`,
        mailboxId: reminder.mailboxId,
        model: job.usageModel,
        promptTokensDetails: {
          cacheWriteTokens: job.usage.cacheWriteTokens,
          cachedTokens: job.usage.cachedTokens,
        },
        usageKind: "mailAction",
        userId: reminder.userId,
      });
      await db
        .update(mailReminderJob)
        .set({ usageReportedAt: new Date() })
        .where(eq(mailReminderJob.id, job.id));
    } catch {
      reportError(new Error("Reminder usage reporting failed."), {
        operation: "reminder-usage",
      });
    }
  }
};

export const recoverSentReminderIntents = async (
  input: { limit?: number } = {}
) => {
  const operations = await db
    .select()
    .from(gmailComposeOperation)
    .where(
      and(
        eq(gmailComposeOperation.kind, "send"),
        eq(gmailComposeOperation.status, "accepted"),
        isNotNull(gmailComposeOperation.followUpReminder)
      )
    )
    .orderBy(gmailComposeOperation.updatedAt, gmailComposeOperation.id)
    .limit(Math.min(input.limit ?? 20, 50));
  for (const operation of operations) {
    if (!operation.followUpReminder) {
      continue;
    }
    if (!operation.response?.threadId) {
      await db
        .update(gmailComposeOperation)
        .set({ followUpReminder: null })
        .where(
          and(
            eq(gmailComposeOperation.id, operation.id),
            eq(gmailComposeOperation.kind, "send"),
            eq(gmailComposeOperation.status, "accepted"),
            sql`nullif(${gmailComposeOperation.response}->>'threadId', '') is null`
          )
        );
      continue;
    }
    await db
      .update(gmailComposeOperation)
      .set({ updatedAt: new Date() })
      .where(eq(gmailComposeOperation.id, operation.id));
    try {
      await materializeSentReminder({
        ...operation.followUpReminder,
        mailboxId: operation.mailboxId,
        messageId: operation.response.id,
        threadId: operation.response.threadId,
      });
      await db
        .update(gmailComposeOperation)
        .set({ followUpReminder: null })
        .where(eq(gmailComposeOperation.id, operation.id));
    } catch {
      reportError(new Error("Sent reminder recovery failed."), {
        operation: "reminder-send-recovery",
      });
    }
  }
  return operations.length;
};

export const processReminderJobs = async (
  input: { limit?: number; allowLocal?: boolean } = {}
) => {
  await recoverSentReminderIntents(input);
  await reportPendingReminderUsage();
  let count = 0;
  for (; count < Math.min(input.limit ?? 4, 20); count += 1) {
    const claimed = await claimReminderJob({ kind: "evaluate" });
    if (!claimed) {
      break;
    }
    const { job, token } = claimed;
    let usage: AiUsageReport | undefined;
    let submitted = job.usageModel !== null;
    let result:
      | Awaited<ReturnType<typeof evaluateReminderCondition>>
      | undefined;
    try {
      const [row] = await db
        .select()
        .from(mailReminder)
        .where(eq(mailReminder.id, job.reminderId))
        .limit(1);
      if (
        row === undefined ||
        row.status !== "active" ||
        row.version !== job.reminderVersion ||
        row.target.kind !== "thread" ||
        !row.target.condition
      ) {
        await finishReminderJob({ id: job.id, token });
        continue;
      }
      const access = await assertReminderScopeAccess(row);
      if (!access) {
        await finishReminderJob({ id: job.id, token });
        continue;
      }
      if (job.usage?.result === undefined) {
        const budget = await getMailAutomationAiBudgetStatus({
          organizationId: access.organizationId,
          userId: row.userId,
        });
        if (
          !budget.allowed &&
          !(
            budget.reason === "environment_disabled" &&
            input.allowLocal === true &&
            serverEnv.QUIETER_DEPLOYMENT_ENV === "local"
          )
        ) {
          await applyReminderEvaluation({
            jobId: job.id,
            reminderId: row.id,
            status: "failed",
            summary:
              "The reply check is unavailable. Your reminder remains active.",
            token,
            version: row.version,
          });
          await finishReminderJob({ id: job.id, token });
          continue;
        }
        await assertCanUseAi({
          organizationId: access.organizationId,
          userId: row.userId,
        });
      }
      const thread = await queriesMailOperations.getThread({
        context: { userId: row.userId },
        input: { mailboxId: row.mailboxId, threadId: row.target.threadId },
      });
      const anchorId = row.target.anchorMessageId;
      const messages = thread.messages.filter(
        (message) =>
          !message.draftId && message.labelIds?.includes("DRAFT") !== true
      );
      const anchorIndex = messages.findIndex(
        (message) => message.id === anchorId
      );
      const anchor = messages[anchorIndex];
      if (anchor === undefined || thread.threadId !== row.target.threadId) {
        throw new Error("The original message is unavailable.");
      }
      const anchorTime =
        Number(anchor.internalDate) || Date.parse(anchor.date ?? "");
      if (!Number.isFinite(anchorTime)) {
        throw new TypeError("The original message timestamp is unavailable.");
      }
      const [identity] = await db
        .select({ email: mailbox.emailAddress })
        .from(mailbox)
        .where(eq(mailbox.id, row.mailboxId))
        .limit(1);
      if (identity === undefined) {
        throw new Error("Mailbox unavailable.");
      }
      const evidence = messages
        .slice(anchorIndex + 1)
        .filter(
          (message) =>
            (Number(message.internalDate) || Date.parse(message.date ?? "")) >=
              anchorTime &&
            message.labelIds?.includes("SENT") !== true &&
            extractMailAddress(message.from ?? "").toLowerCase() !==
              identity.email.toLowerCase()
        )
        .slice(-12);
      if (!evidence.length) {
        await applyReminderEvaluation({
          jobId: job.id,
          reminderId: row.id,
          status: "unfulfilled",
          summary: "No subsequent reply is available.",
          token,
          version: row.version,
        });
        await finishReminderJob({ id: job.id, token });
        continue;
      }
      if (submitted && job.usage?.result === undefined) {
        await applyReminderEvaluation({
          jobId: job.id,
          reminderId: row.id,
          status: "failed",
          summary:
            "A reply check was interrupted. Your reminder remains active.",
          token,
          version: row.version,
        });
        await finishReminderJob({ id: job.id, token });
        continue;
      }
      if (job.usage?.result === undefined) {
        const [submission] = await db
          .update(mailReminderJob)
          .set({ usageModel: resolveBackgroundModel() })
          .where(
            and(
              eq(mailReminderJob.id, job.id),
              eq(mailReminderJob.leaseToken, token),
              sql`${mailReminderJob.leaseUntil} > now()`
            )
          )
          .returning({ id: mailReminderJob.id });
        if (submission === undefined) {
          continue;
        }
        submitted = true;
      }
      const decision =
        job.usage?.result ??
        (await evaluateReminderCondition({
          anchor: {
            bodyText: (
              anchor.bodyText ||
              convert((anchor.bodyHtml ?? "").slice(0, 20_000)) ||
              anchor.snippet ||
              ""
            ).slice(0, 6000),
            date: anchor.date,
            from: anchor.from,
            id: anchor.id,
          },
          billing: await createMailboxAiBillingContext({
            externalId: `reminder:${job.id}`,
            mailboxId: row.mailboxId,
            usageKind: "mailAction",
            userId: row.userId,
          }),
          condition: row.target.condition,
          messages: evidence.map((message) => ({
            attachments:
              message.attachments
                ?.slice(0, 20)
                .map((attachment) => ({ name: attachment.fileName })) ?? [],
            bodyText: (
              message.bodyText ||
              convert((message.bodyHtml ?? "").slice(0, 20_000)) ||
              message.snippet ||
              ""
            ).slice(0, 6000),
            date: message.date,
            from: message.from,
            id: message.id,
          })),
          onUsage: (report) => {
            usage = report;
          },
        }));
      result = decision;
      if (usage) {
        await db
          .update(mailReminderJob)
          .set({
            usage: { ...usage, result: decision },
            usageModel: resolveBackgroundModel(),
          })
          .where(
            and(
              eq(mailReminderJob.id, job.id),
              eq(mailReminderJob.leaseToken, token)
            )
          );
      }
      const evidenceIds = new Set(evidence.map((message) => message.id));
      if (
        decision.kind === "fulfilled" &&
        (!decision.evidenceMessageIds.length ||
          decision.evidenceMessageIds.some((id) => !evidenceIds.has(id)))
      ) {
        throw new Error("Reply evidence could not be verified.");
      }
      if (!(await assertReminderScopeAccess(row))) {
        await finishReminderJob({ id: job.id, token });
        continue;
      }
      await applyReminderEvaluation({
        jobId: job.id,
        reminderId: row.id,
        status: decision.kind,
        summary: decision.explanation,
        token,
        version: row.version,
      });
      await finishReminderJob({ id: job.id, token });
    } catch (error) {
      const admissionBusy =
        job.usageModel === null &&
        usage === undefined &&
        isAiCreditAdmissionBusy(error);
      if (
        !(error instanceof ORPCError && error.status < 500) &&
        !admissionBusy
      ) {
        reportError(new Error("Reminder reply check failed."), {
          operation: "reminder-evaluation",
        });
      }
      if (admissionBusy) {
        await db
          .update(mailReminderJob)
          .set({ usageModel: null })
          .where(
            and(
              eq(mailReminderJob.id, job.id),
              eq(mailReminderJob.leaseToken, token),
              sql`${mailReminderJob.leaseUntil} > now()`
            )
          );
      }
      await applyReminderEvaluation({
        jobId: job.id,
        reminderId: job.reminderId,
        status: "failed",
        summary:
          "The reply check could not finish. Your reminder remains active.",
        token,
        version: job.reminderVersion,
      });
      await finishReminderJob({
        id: job.id,
        retry:
          (!submitted || admissionBusy) &&
          usage === undefined &&
          job.attempts < 3,
        token,
      });
    } finally {
      if (usage) {
        await db
          .update(mailReminderJob)
          .set({
            usage: { ...usage, ...(result ? { result } : {}) },
            usageModel: resolveBackgroundModel(),
          })
          .where(
            and(
              eq(mailReminderJob.id, job.id),
              eq(mailReminderJob.attempts, job.attempts)
            )
          );
      }
    }
  }
  await reportPendingReminderUsage();
  const suggestions = await processReminderSuggestions(input);
  return { count, suggestions };
};
