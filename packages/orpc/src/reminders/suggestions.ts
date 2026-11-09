import { ORPCError } from "@orpc/server";
import type { AiUsageReport } from "@quieter/ai/chat-usage";
import { isAiCreditAdmissionBusy } from "@quieter/ai/errors";
import { resolveBackgroundModel } from "@quieter/ai/model-config";
import { extractReminderSuggestion } from "@quieter/ai/reminders";
import { reportAiUsage } from "@quieter/billing";
import { createMailboxAiBillingContext } from "@quieter/billing/ai-reservation";
import { db } from "@quieter/database/client";
import {
  mailbox,
  mailReminder,
  mailReminderPreference,
  mailReminderSuggestion,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { extractMailAddress } from "@quieter/mail/compose/schema";
import type { ReminderSuggestion } from "@quieter/mail/reminders";
import {
  reminderSuggestionInputSchema,
  updateReminderPreferencesSchema,
} from "@quieter/mail/reminders";
import { reportError } from "@quieter/observability";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { convert } from "html-to-text";

import { assertCanUseAi } from "../ai-access";
import { getMailAutomationAiBudgetStatus } from "../mail-automation/ai-budget";
import { queriesMailOperations } from "../mail/queries";
import { assertAccessibleMailbox } from "../mailbox/service";
import { createReminder, getReminder } from "./service";
import {
  claimReminderSuggestion,
  enqueueReminderSuggestion,
} from "./suggestion-store";
import type { SuggestionRow } from "./suggestion-store";

type Scope = { userId: string; mailboxId: string };
type SuggestionResponse = {
  status: "pending" | "none" | "ready";
  suggestion: ReminderSuggestion | null;
};

export const getReminderPreferences = async (input: Scope) => {
  await assertAccessibleMailbox(input);
  const [row] = await db
    .select()
    .from(mailReminderPreference)
    .where(
      and(
        eq(mailReminderPreference.userId, input.userId),
        eq(mailReminderPreference.mailboxId, input.mailboxId)
      )
    )
    .limit(1);
  return {
    automatic: row?.automatic ?? false,
    suggestions: row?.suggestions ?? true,
    timeZone: row?.timeZone ?? "UTC",
  };
};

export const updateReminderPreferences = async (
  input: Scope & { automatic: boolean; suggestions: boolean; timeZone: string }
) => {
  const value = updateReminderPreferencesSchema.parse({
    automatic: input.automatic,
    mailboxId: input.mailboxId,
    suggestions: input.suggestions,
    timeZone: input.timeZone,
  });
  await assertAccessibleMailbox(input);
  await db
    .insert(mailReminderPreference)
    .values({ ...value, updatedAt: new Date(), userId: input.userId })
    .onConflictDoUpdate({
      set: {
        automatic: value.automatic,
        suggestions: value.suggestions,
        timeZone: value.timeZone,
        updatedAt: new Date(),
      },
      target: [mailReminderPreference.userId, mailReminderPreference.mailboxId],
    });
  return {
    automatic: value.automatic,
    suggestions: value.suggestions,
    timeZone: value.timeZone,
  };
};

const suggestionResponse = (row: SuggestionRow): SuggestionResponse => {
  if (row.status === "pending") {
    return { status: "pending", suggestion: null };
  }
  if (!row.result || row.status === "none") {
    return { status: "none", suggestion: null };
  }
  if (
    row.status === "suggested" &&
    Date.parse(row.result.dueAt) <= Date.now()
  ) {
    return { status: "none", suggestion: null };
  }
  return {
    status: "ready",
    suggestion: {
      condition: row.result.condition,
      confidence: row.result.confidence,
      dueAt: row.result.dueAt,
      id: row.id,
      mailboxId: row.mailboxId,
      messageId: row.messageId,
      reason: row.result.reason,
      reminderId: row.reminderId,
      status: row.status,
      threadId: row.threadId,
      timeZone: row.timeZone,
      title: row.result.title,
    },
  };
};

const reportSuggestionUsage = async () => {
  const rows = await db
    .select()
    .from(mailReminderSuggestion)
    .where(
      and(
        isNotNull(mailReminderSuggestion.usage),
        isNull(mailReminderSuggestion.usageReportedAt)
      )
    )
    .limit(20);
  for (const row of rows) {
    if (!row.usage || !row.usageModel) {
      continue;
    }
    try {
      await reportAiUsage({
        ...row.usage,
        costUsd: row.usage.costUsd,
        externalId: `reminder-suggestion:${row.id}`,
        mailboxId: row.mailboxId,
        model: row.usageModel,
        promptTokensDetails: {
          cacheWriteTokens: row.usage.cacheWriteTokens,
          cachedTokens: row.usage.cachedTokens,
        },
        usageKind: "mailAction",
        userId: row.userId,
      });
      await db
        .update(mailReminderSuggestion)
        .set({ usageReportedAt: new Date() })
        .where(eq(mailReminderSuggestion.id, row.id));
    } catch {
      reportError(new Error("Reminder suggestion usage reporting failed."), {
        operation: "reminder-suggestion-usage",
      });
    }
  }
};

const createSuggestedReminder = async (
  row: SuggestionRow,
  automatic: boolean
) => {
  if (!row.result) {
    throw new ORPCError("CONFLICT", {
      message: "This suggestion is unavailable.",
    });
  }
  const reminder = await createReminder({
    dueAt: row.result.dueAt,
    mailboxId: row.mailboxId,
    requestId: row.id,
    source: {
      kind: automatic ? "automatic" : "suggestion",
      messageId: row.messageId,
      reason: row.result.reason,
    },
    suggestionLeaseToken: row.leaseToken ?? undefined,
    target: {
      anchorMessageId: row.messageId,
      condition: row.result.condition,
      kind: "thread",
      threadId: row.threadId,
    },
    timeZone: row.timeZone,
    title: row.result.title,
    userId: row.userId,
  });
  await db
    .update(mailReminderSuggestion)
    .set({ reminderId: reminder.id, status: "accepted" })
    .where(
      and(
        eq(mailReminderSuggestion.id, row.id),
        sql`${mailReminderSuggestion.status} != 'dismissed'`
      )
    );
  return reminder;
};

const processSuggestion = async (
  claimed: NonNullable<Awaited<ReturnType<typeof claimReminderSuggestion>>>,
  allowLocal = false
) => {
  const { row, token } = claimed;
  const lease = and(
    eq(mailReminderSuggestion.id, row.id),
    eq(mailReminderSuggestion.leaseToken, token),
    sql`${mailReminderSuggestion.leaseUntil} > now()`
  );
  let usage: AiUsageReport | undefined;
  try {
    const access = await assertAccessibleMailbox(row);
    const preferences = await getReminderPreferences(row);
    if (row.automatic ? !preferences.automatic : !preferences.suggestions) {
      await db
        .update(mailReminderSuggestion)
        .set({ status: "none" })
        .where(lease);
      return;
    }
    if (
      !row.result &&
      (row.usage || (row.attempts > 1 && row.fingerprint !== null))
    ) {
      await db
        .update(mailReminderSuggestion)
        .set({ status: "none" })
        .where(lease);
      return;
    }
    let { result } = row;
    if (!result) {
      if (row.automatic) {
        const budget = await getMailAutomationAiBudgetStatus({
          organizationId: access.organizationId,
          userId: row.userId,
        });
        if (
          !budget.allowed &&
          !(
            budget.reason === "environment_disabled" &&
            allowLocal &&
            serverEnv.QUIETER_DEPLOYMENT_ENV === "local"
          )
        ) {
          throw new ORPCError("FORBIDDEN", { message: budget.message });
        }
      }
      await assertCanUseAi({
        organizationId: access.organizationId,
        userId: row.userId,
      });
      const [identity] = await db
        .select({ email: mailbox.emailAddress })
        .from(mailbox)
        .where(eq(mailbox.id, row.mailboxId))
        .limit(1);
      if (identity === undefined) {
        throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
      }
      const thread = await queriesMailOperations.getThread({
        context: { userId: row.userId },
        input: { mailboxId: row.mailboxId, threadId: row.threadId },
      });
      const message = thread.messages.find((item) => item.id === row.messageId);
      if (
        thread.threadId !== row.threadId ||
        !message ||
        message.draftId ||
        message.labelIds?.includes("DRAFT") === true ||
        message.labelIds?.includes("SENT") === true ||
        extractMailAddress(message.from ?? "").toLowerCase() ===
          identity.email.toLowerCase()
      ) {
        await db
          .update(mailReminderSuggestion)
          .set({ status: "none" })
          .where(lease);
        return;
      }
      const evidence = {
        bodyText: (
          message.bodyText ||
          convert((message.bodyHtml ?? "").slice(0, 30_000)) ||
          message.snippet ||
          ""
        ).slice(0, 12_000),
        date:
          message.date ?? new Date(Number(message.internalDate)).toISOString(),
        from: message.from ?? "",
        id: message.id,
        subject: message.subject ?? thread.subject ?? "",
        to: message.to ?? "",
      };
      const fingerprint = [
        ...new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(JSON.stringify(evidence))
          )
        ),
      ]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const [submission] = await db
        .update(mailReminderSuggestion)
        .set({ fingerprint })
        .where(lease)
        .returning({ id: mailReminderSuggestion.id });
      if (submission === undefined) {
        return;
      }
      const extracted = await extractReminderSuggestion({
        billing: await createMailboxAiBillingContext({
          externalId: `reminder-suggestion:${row.id}`,
          mailboxId: row.mailboxId,
          usageKind: "mailAction",
          userId: row.userId,
        }),
        message: evidence,
        now: new Date().toISOString(),
        onUsage: (report) => {
          usage = report;
        },
        recipient: identity.email,
        timeZone: row.timeZone,
      });
      const decision = extracted.suggestion;
      const deadline =
        decision === null ? Number.NaN : Date.parse(decision.dueAt);
      const sourceText = `${evidence.subject}\n${evidence.bodyText}`;
      if (
        decision !== null &&
        decision.confidence === "clear" &&
        deadline > Date.now() &&
        deadline <= Date.now() + 366 * 86_400_000 &&
        sourceText.includes(decision.actionEvidence) &&
        sourceText.includes(decision.deadlineEvidence)
      ) {
        result = {
          automaticEligible: decision.explicitInstant,
          condition: decision.condition,
          confidence: decision.confidence,
          dueAt: decision.dueAt,
          reason: decision.reason,
          title: decision.title,
        };
      }
      const saved = await db
        .update(mailReminderSuggestion)
        .set({
          result,
          status: result ? "pending" : "none",
          usage: usage ?? null,
          usageModel: usage ? resolveBackgroundModel() : null,
        })
        .where(lease)
        .returning();
      if (saved.length === 0 || !result) {
        return;
      }
    }
    await assertAccessibleMailbox(row);
    const current = await getReminderPreferences(row);
    const [ready] = await db
      .update(mailReminderSuggestion)
      .set({
        status: sql`case when ${mailReminderSuggestion.automatic}
          and ${current.automatic} and ${result.automaticEligible}
          then 'pending' else ${current.suggestions ? "suggested" : "none"} end`,
      })
      .where(lease)
      .returning();
    if (ready?.automatic && current.automatic && result.automaticEligible) {
      await createSuggestedReminder({ ...ready, result }, true);
    }
  } catch (error) {
    const admissionBusy = usage === undefined && isAiCreditAdmissionBusy(error);
    if (!(error instanceof ORPCError && error.status < 500) && !admissionBusy) {
      reportError(new Error("Reminder suggestion could not finish."), {
        operation: "reminder-suggestion",
      });
    }
    const retry =
      usage === undefined &&
      row.attempts < 3 &&
      (admissionBusy || !(error instanceof ORPCError && error.status < 500));
    await db
      .update(mailReminderSuggestion)
      .set({
        availableAt: new Date(Date.now() + 30_000),
        status: retry ? "pending" : "none",
        ...(admissionBusy ? { fingerprint: null } : {}),
        ...(usage ? { usage, usageModel: resolveBackgroundModel() } : {}),
      })
      .where(lease);
  } finally {
    await db
      .update(mailReminderSuggestion)
      .set({ leaseToken: null, leaseUntil: null })
      .where(lease);
  }
};

export const getReminderSuggestion = async (
  input: Scope & { threadId: string; messageId: string; timeZone: string }
): Promise<SuggestionResponse> => {
  const value = reminderSuggestionInputSchema.parse({
    mailboxId: input.mailboxId,
    messageId: input.messageId,
    threadId: input.threadId,
    timeZone: input.timeZone,
  });
  const preferences = await getReminderPreferences(input);
  if (!preferences.suggestions) {
    return { status: "none", suggestion: null };
  }
  const row = await enqueueReminderSuggestion({
    ...value,
    automatic: false,
    userId: input.userId,
  });
  if (row.threadId !== input.threadId) {
    return { status: "none", suggestion: null };
  }
  if (row.status === "pending") {
    const claimed = await claimReminderSuggestion(row.id);
    if (claimed) {
      await processSuggestion(claimed);
    }
  }
  const [current] = await db
    .select()
    .from(mailReminderSuggestion)
    .where(eq(mailReminderSuggestion.id, row.id))
    .limit(1);
  await reportSuggestionUsage();
  return current === undefined
    ? { status: "none", suggestion: null }
    : suggestionResponse(current);
};

export const acceptReminderSuggestion = async (
  input: Scope & { suggestionId: string }
) => {
  await assertAccessibleMailbox(input);
  const row = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(mailReminderSuggestion)
      .where(
        and(
          eq(mailReminderSuggestion.id, input.suggestionId),
          eq(mailReminderSuggestion.userId, input.userId),
          eq(mailReminderSuggestion.mailboxId, input.mailboxId)
        )
      )
      .for("update");
    if (
      current === undefined ||
      current.status === "dismissed" ||
      current.status === "none" ||
      current.status === "pending" ||
      !current.result
    ) {
      throw new ORPCError("NOT_FOUND", {
        message: "This suggestion is unavailable.",
      });
    }
    if (current.status === "accepted") {
      return current;
    }
    if (current.leaseUntil && current.leaseUntil.getTime() > Date.now()) {
      throw new ORPCError("CONFLICT", {
        message: "This suggestion is being saved. Try again shortly.",
      });
    }
    const [leased] = await tx
      .update(mailReminderSuggestion)
      .set({
        leaseToken: crypto.randomUUID(),
        leaseUntil: new Date(Date.now() + 120_000),
      })
      .where(eq(mailReminderSuggestion.id, current.id))
      .returning();
    if (leased === undefined) {
      throw new Error("Reminder suggestion is unavailable.");
    }
    return leased;
  });
  if (row.status === "accepted" && row.reminderId) {
    return await getReminder({ ...input, reminderId: row.reminderId });
  }
  try {
    return await createSuggestedReminder(row, false);
  } finally {
    await db
      .update(mailReminderSuggestion)
      .set({ leaseToken: null, leaseUntil: null })
      .where(
        and(
          eq(mailReminderSuggestion.id, row.id),
          eq(mailReminderSuggestion.leaseToken, row.leaseToken ?? "")
        )
      );
  }
};

export const dismissReminderSuggestion = async (
  input: Scope & { suggestionId: string }
) => {
  await assertAccessibleMailbox(input);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(mailReminderSuggestion)
      .where(
        and(
          eq(mailReminderSuggestion.id, input.suggestionId),
          eq(mailReminderSuggestion.userId, input.userId),
          eq(mailReminderSuggestion.mailboxId, input.mailboxId)
        )
      )
      .for("update");
    if (row === undefined || row.status === "accepted") {
      return;
    }
    if (row.leaseUntil && row.leaseUntil.getTime() > Date.now()) {
      throw new ORPCError("CONFLICT", {
        message: "This suggestion is being saved. Try again shortly.",
      });
    }
    const [created] = await tx
      .select({ id: mailReminder.id })
      .from(mailReminder)
      .where(
        and(
          eq(mailReminder.requestId, row.id),
          eq(mailReminder.userId, row.userId),
          eq(mailReminder.mailboxId, row.mailboxId)
        )
      )
      .limit(1);
    await tx
      .update(mailReminderSuggestion)
      .set(
        created === undefined
          ? { status: "dismissed" }
          : { reminderId: created.id, status: "accepted" }
      )
      .where(eq(mailReminderSuggestion.id, row.id));
  });
};

export const processReminderSuggestions = async (
  input: { limit?: number; allowLocal?: boolean } = {}
) => {
  await reportSuggestionUsage();
  let count = 0;
  for (; count < Math.min(input.limit ?? 2, 5); count += 1) {
    const claimed = await claimReminderSuggestion();
    if (!claimed) {
      break;
    }
    await processSuggestion(claimed, input.allowLocal);
  }
  await reportSuggestionUsage();
  return count;
};
