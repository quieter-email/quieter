import { randomUUID } from "node:crypto";

import type { AiUsageReport } from "@quieter/ai/chat-usage";
import { classifyMailMessage } from "@quieter/ai/classify-gmail-message";
import type {
  AutomationMailMessage,
  MailAutoLabelCandidate,
} from "@quieter/ai/classify-gmail-message";
import { isAiCreditAdmissionBusy } from "@quieter/ai/errors";
import { AI_CREDIT_ADMISSION_BUSY_MESSAGE } from "@quieter/billing/ai-credit-errors";
import { createMailboxAiBillingContext } from "@quieter/billing/ai-reservation";
import { hasUserBillingFeature } from "@quieter/billing/entitlements";
import { db } from "@quieter/database/client";
import {
  gmailAutoLabelEvent,
  mailbox,
  mailboxAutomationSettings,
  managedMailAttachment,
  managedMailLabel,
  managedMailMessage,
  organization,
} from "@quieter/database/schema";
import { partitionAutoLabelCandidates } from "@quieter/mail/auto-label-matching";
import { MAILBOX_LABELS } from "@quieter/mail/messages";
import { parseOtpTokenHeaders } from "@quieter/mail/otp-token";
import { reportError } from "@quieter/observability";
import { and, asc, desc, eq, isNull, lte, or } from "drizzle-orm";

import {
  buildMailMemoryQuery,
  loadAiAgentMemoryCandidates,
  loadAiConfiguration,
  loadAiAgentContext,
  serializeAiAgentContext,
} from "../ai-memory";
import type { AiAgentMemoryCandidates } from "../ai-memory";
import { getMailboxMemoryActor } from "../ai-memory-capture";
import { getMailAutomationAiBudgetStatus } from "../mail-automation/ai-budget";
import {
  autoLabelBudgetDeferred,
  deferAutoLabelAutomation,
} from "../mail-automation/auto-label-events";
import { loadManagedAutomationLabelHistory } from "../mail-automation/history";
import { reportAutoLabelUsage } from "../mail-automation/usage";
import { runReceiveStage } from "../mail-receive";
import type { ReceiveStageOutcome } from "../mail-receive";
import { updateManagedMessageLabelAssignments } from "./labels/repository";

const AUTO_LABEL_RETRY_BASE_MS = 1000 * 60 * 5;
const AUTO_LABEL_RETRY_MAX_MS = 1000 * 60 * 60 * 24;

type ManagedAutoLabelContext = {
  availableLabelIds: Set<string>;
  historyLabels: Pick<MailAutoLabelCandidate, "id" | "name">[];
  labels: MailAutoLabelCandidate[];
  memoryCandidates: AiAgentMemoryCandidates | null;
  memoryUserId: string | null;
  model: string;
};

const toAutomationMessage = (
  message: typeof managedMailMessage.$inferSelect,
  attachments: { fileName: string; mimeType: string }[]
): AutomationMailMessage => {
  const labelsByState = {
    active: [
      MAILBOX_LABELS.inbox,
      ...(message.isRead ? [] : [MAILBOX_LABELS.unread]),
    ],
    done: [
      MAILBOX_LABELS.done,
      ...(message.isRead ? [] : [MAILBOX_LABELS.unread]),
    ],
    draft: [MAILBOX_LABELS.drafts],
    spam: [MAILBOX_LABELS.spam],
    trash: [MAILBOX_LABELS.trash],
  };
  return {
    attachments,
    bcc: message.bcc,
    bodyHtml: message.bodyHtml,
    bodyText: message.bodyText,
    cc: message.cc,
    from: message.from,
    id: message.id,
    internalDate: String(message.createdAt.getTime()),
    labelIds:
      message.direction === "outbound"
        ? [MAILBOX_LABELS.sent]
        : labelsByState[message.mailboxState],
    otpToken: parseOtpTokenHeaders(message.headers ?? []) ?? undefined,
    snippet: message.snippet,
    subject: message.subject,
    threadId: message.threadId,
    to: message.to,
  };
};

export const loadManagedAutomationMessage = async (
  mailboxId: string,
  messageId: string,
  options: { includeNonInbox?: boolean } = {}
) => {
  const [message] = await db
    .select()
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, mailboxId),
        eq(managedMailMessage.id, messageId)
      )
    )
    .limit(1);
  if (
    message === undefined ||
    message.direction !== "inbound" ||
    (options.includeNonInbox !== true && message.mailboxState !== "active")
  ) {
    return null;
  }

  const attachments = await db
    .select({
      fileName: managedMailAttachment.fileName,
      mimeType: managedMailAttachment.mimeType,
    })
    .from(managedMailAttachment)
    .where(eq(managedMailAttachment.messageId, message.id));

  return toAutomationMessage(message, attachments);
};

const getManagedAutoLabelCandidates = async (input: {
  mailboxId: string;
  userId: string;
}): Promise<ManagedAutoLabelContext> => {
  const memoryActor = await getMailboxMemoryActor({
    mailboxId: input.mailboxId,
  });
  const [labels, aiConfiguration, memoryCandidates] = await Promise.all([
    db
      .select({
        autoLabel: managedMailLabel.autoLabel,
        description: managedMailLabel.description,
        id: managedMailLabel.id,
        name: managedMailLabel.name,
      })
      .from(managedMailLabel)
      .where(eq(managedMailLabel.mailboxId, input.mailboxId)),
    Promise.resolve(loadAiConfiguration()),
    memoryActor === null
      ? null
      : loadAiAgentMemoryCandidates({
          mailboxId: input.mailboxId,
          userId: memoryActor.userId,
        }),
  ]);

  const candidates = labels
    .filter((label) => label.autoLabel?.enabled !== false)
    .map((label) => ({
      autoLabel: label.autoLabel,
      description: label.description,
      id: label.id,
      inclusionCriteria: null,
      name: label.name,
    }));

  return {
    availableLabelIds: new Set(candidates.map((label) => label.id)),
    historyLabels: labels.map(({ id, name }) => ({ id, name })),
    labels: candidates,
    memoryCandidates,
    memoryUserId: memoryActor?.userId ?? null,
    model: aiConfiguration.autoLabelModel,
  };
};

const getAutomationOwner = async (mailboxId: string) => {
  const [record] = await db
    .select({
      billingOwnerUserId: organization.billingOwnerUserId,
      organizationId: mailbox.organizationId,
    })
    .from(mailbox)
    .innerJoin(organization, eq(organization.id, mailbox.organizationId))
    .where(eq(mailbox.id, mailboxId))
    .limit(1);

  if (record === undefined || !record.billingOwnerUserId) {
    return null;
  }
  return {
    organizationId: record.organizationId,
    userId: record.billingOwnerUserId,
  };
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message.slice(0, 2000)
    : "Unknown managed mail automation error.";

const getOrCreateManagedAutoLabelEvent = async (
  mailboxId: string,
  messageId: string
) => {
  const now = new Date();
  await db
    .insert(gmailAutoLabelEvent)
    .values({
      createdAt: now,
      gmailMessageId: messageId,
      id: randomUUID(),
      mailboxId,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const [event] = await db
    .select()
    .from(gmailAutoLabelEvent)
    .where(
      and(
        eq(gmailAutoLabelEvent.mailboxId, mailboxId),
        eq(gmailAutoLabelEvent.gmailMessageId, messageId)
      )
    )
    .limit(1);

  if (event === undefined) {
    throw new Error("Could not create managed auto-label event.");
  }

  return event;
};

const markManagedAutoLabelEventAppliedWithoutUsage = async (
  eventId: string
) => {
  const now = new Date();
  const [applied] = await db
    .update(gmailAutoLabelEvent)
    .set({
      appliedAt: now,
      labelIds: [],
      lastError: null,
      nextAttemptAt: null,
      updatedAt: now,
      usageReportedAt: now,
    })
    .where(eq(gmailAutoLabelEvent.id, eventId))
    .returning({ id: gmailAutoLabelEvent.id });
  if (applied === undefined) {
    throw new Error("Managed auto-label event is unavailable.");
  }
};

const processManagedAutoLabelMessage = async (input: {
  autoLabelContext: ManagedAutoLabelContext;
  mailboxId: string;
  messageId: string;
  organizationId: string;
  userId: string;
}): Promise<ReceiveStageOutcome<"auto_label">> => {
  let event = await getOrCreateManagedAutoLabelEvent(
    input.mailboxId,
    input.messageId
  );
  if (event.appliedAt) {
    await reportAutoLabelUsage({ ...event, userId: input.userId });
    return { status: "complete" };
  }

  try {
    if (event.nextAttemptAt && event.nextAttemptAt > new Date()) {
      let reason: "admission_busy" | "budget" | "failure" = "failure";
      if (event.lastError === AI_CREDIT_ADMISSION_BUSY_MESSAGE) {
        reason = "admission_busy";
      } else if (
        event.attemptCount === 0 &&
        event.labelIds === null &&
        event.lastError !== null
      ) {
        reason = "budget";
      }
      const budgetStatus =
        reason === "budget"
          ? await getMailAutomationAiBudgetStatus({
              organizationId: input.organizationId,
              userId: input.userId,
            })
          : null;
      if (budgetStatus?.allowed !== true) {
        return { reason, retryAt: event.nextAttemptAt, status: "retry" };
      }
    }
    if (event.labelIds === null || event.labelIds === undefined) {
      if (input.autoLabelContext.labels.length === 0) {
        await markManagedAutoLabelEventAppliedWithoutUsage(event.id);
        return { status: "complete" };
      }

      const message = await loadManagedAutomationMessage(
        input.mailboxId,
        input.messageId
      );
      if (message === null) {
        await markManagedAutoLabelEventAppliedWithoutUsage(event.id);
        return { status: "complete" };
      }

      let usage: AiUsageReport = {
        cacheWriteTokens: 0,
        cachedTokens: 0,
        completionTokens: 0,
        costUsd: undefined,
        promptTokens: 0,
      };
      const { aiLabels, deterministicLabelIds } = partitionAutoLabelCandidates(
        input.autoLabelContext.labels,
        message
      );
      if (aiLabels.length > 0) {
        const budgetStatus = await getMailAutomationAiBudgetStatus({
          organizationId: input.organizationId,
          userId: input.userId,
        });
        if (!budgetStatus.allowed) {
          if (deterministicLabelIds.length > 0) {
            await updateManagedMessageLabelAssignments({
              addLabelIds: deterministicLabelIds,
              mailboxId: input.mailboxId,
              messageIds: [input.messageId],
              source: "ai_auto_label",
            });
          }
          const retryAt = await deferAutoLabelAutomation(
            event.id,
            budgetStatus.message
          );
          return { reason: "budget", retryAt, status: "retry" };
        }
      }

      const { memoryCandidates, memoryUserId } = input.autoLabelContext;
      const [memoryContext, labelHistory] = await Promise.all([
        aiLabels.length === 0 ||
        memoryCandidates === null ||
        memoryUserId === null
          ? null
          : loadAiAgentContext({
              agent: "auto_label",
              candidates: memoryCandidates,
              mailboxId: input.mailboxId,
              query: buildMailMemoryQuery(message),
              semantic: { billingMailboxId: input.mailboxId },
              userId: memoryUserId,
            }),
        aiLabels.length === 0
          ? null
          : loadManagedAutomationLabelHistory({
              labels: input.autoLabelContext.historyLabels,
              mailboxId: input.mailboxId,
              message,
              provider: "managed",
            }),
      ]);
      const aiLabelIds =
        aiLabels.length === 0
          ? []
          : await classifyMailMessage({
              billing: await createMailboxAiBillingContext({
                externalId: event.id,
                mailboxId: input.mailboxId,
                usageKind: "autoLabel",
                userId: input.userId,
              }),
              labelHistory,
              labels: aiLabels,
              memoryContext:
                memoryContext === null
                  ? null
                  : serializeAiAgentContext(memoryContext),
              message,
              model: input.autoLabelContext.model,
              onUsage: (reportedUsage) => {
                usage = reportedUsage;
              },
            });
      const labelIds = [...new Set([...deterministicLabelIds, ...aiLabelIds])];
      const [classified] = await db
        .update(gmailAutoLabelEvent)
        .set({
          cacheWriteTokens: usage.cacheWriteTokens,
          cachedTokens: usage.cachedTokens,
          completionTokens: usage.completionTokens,
          costUsd: usage.costUsd ?? null,
          labelIds,
          lastError: null,
          model: aiLabels.length > 0 ? input.autoLabelContext.model : null,
          promptTokens: usage.promptTokens,
          updatedAt: new Date(),
          // Unreportable usage is terminal; only retryable reporting failures
          // keep usageReportedAt unset.
          usageReportedAt: usage.costUsd === undefined ? new Date() : null,
        })
        .where(eq(gmailAutoLabelEvent.id, event.id))
        .returning();
      if (classified === undefined) {
        throw new Error("Managed auto-label classification was not saved.");
      }
      event = classified;
    }

    const labelIds = (event.labelIds ?? []).filter((labelId) =>
      input.autoLabelContext.availableLabelIds.has(labelId)
    );

    const currentMessage =
      labelIds.length > 0
        ? await loadManagedAutomationMessage(input.mailboxId, input.messageId)
        : null;

    const now = new Date();
    await db.transaction(async (transaction) => {
      if (labelIds.length > 0 && currentMessage) {
        await updateManagedMessageLabelAssignments({
          addLabelIds: labelIds,
          database: transaction,
          mailboxId: input.mailboxId,
          messageIds: [input.messageId],
          source: "ai_auto_label",
        });
      }
      const [applied] = await transaction
        .update(gmailAutoLabelEvent)
        .set({
          appliedAt: now,
          lastError: null,
          nextAttemptAt: null,
          updatedAt: now,
        })
        .where(eq(gmailAutoLabelEvent.id, event.id))
        .returning({ id: gmailAutoLabelEvent.id });
      if (applied === undefined) {
        throw new Error("Managed auto-label application was not saved.");
      }
    });
    await reportAutoLabelUsage({ ...event, userId: input.userId });
    return { status: "complete" };
  } catch (error) {
    if (isAiCreditAdmissionBusy(error)) {
      const retryAt = await deferAutoLabelAutomation(
        event.id,
        AI_CREDIT_ADMISSION_BUSY_MESSAGE
      );
      return { reason: "admission_busy", retryAt, status: "retry" };
    }
    const now = new Date();
    const attemptCount = event.attemptCount + 1;
    const [saved] = await db
      .update(gmailAutoLabelEvent)
      .set({
        attemptCount,
        lastError: getErrorMessage(error),
        nextAttemptAt: new Date(
          now.getTime() +
            Math.min(
              AUTO_LABEL_RETRY_MAX_MS,
              AUTO_LABEL_RETRY_BASE_MS * 2 ** (attemptCount - 1)
            )
        ),
        updatedAt: now,
      })
      .where(eq(gmailAutoLabelEvent.id, event.id))
      .returning({ retryAt: gmailAutoLabelEvent.nextAttemptAt });
    if (!saved?.retryAt) {
      throw new Error("Managed auto-label retry was not saved.", {
        cause: error,
      });
    }
    reportError(error, { operation: "managed-mail:auto-label-message" });
    return { reason: "failure", retryAt: saved.retryAt, status: "retry" };
  }
};

const listPendingManagedAutoLabelMessageIds = async (input: {
  mailboxId: string;
  organizationId: string;
  userId: string;
}) => {
  const now = new Date();
  const events = await db
    .select({
      messageId: gmailAutoLabelEvent.gmailMessageId,
      nextAttemptAt: gmailAutoLabelEvent.nextAttemptAt,
    })
    .from(gmailAutoLabelEvent)
    .where(
      and(
        eq(gmailAutoLabelEvent.mailboxId, input.mailboxId),
        isNull(gmailAutoLabelEvent.appliedAt),
        or(
          isNull(gmailAutoLabelEvent.nextAttemptAt),
          lte(gmailAutoLabelEvent.nextAttemptAt, now),
          autoLabelBudgetDeferred
        )
      )
    )
    .orderBy(
      desc(isNull(gmailAutoLabelEvent.nextAttemptAt)),
      asc(gmailAutoLabelEvent.nextAttemptAt)
    )
    .limit(20);

  const budgetStatus = events.some(
    (event) => event.nextAttemptAt !== null && event.nextAttemptAt > now
  )
    ? await getMailAutomationAiBudgetStatus(input)
    : null;
  const resumeBudgetDeferred = budgetStatus?.allowed ?? false;

  return events
    .filter(
      (event) =>
        event.nextAttemptAt === null ||
        event.nextAttemptAt <= now ||
        resumeBudgetDeferred
    )
    .map((event) => event.messageId);
};

const reportPendingManagedAutoLabelUsage = async (
  mailboxId: string,
  userId: string
) => {
  const events = await db
    .select({
      cacheWriteTokens: gmailAutoLabelEvent.cacheWriteTokens,
      cachedTokens: gmailAutoLabelEvent.cachedTokens,
      completionTokens: gmailAutoLabelEvent.completionTokens,
      costUsd: gmailAutoLabelEvent.costUsd,
      id: gmailAutoLabelEvent.id,
      model: gmailAutoLabelEvent.model,
      promptTokens: gmailAutoLabelEvent.promptTokens,
      usageReportedAt: gmailAutoLabelEvent.usageReportedAt,
    })
    .from(gmailAutoLabelEvent)
    .where(
      and(
        eq(gmailAutoLabelEvent.mailboxId, mailboxId),
        isNull(gmailAutoLabelEvent.usageReportedAt)
      )
    )
    .limit(100);

  await Promise.all(
    events.map(async (event) => {
      await reportAutoLabelUsage({ ...event, mailboxId, userId });
    })
  );
};

export const processManagedMailAutomation = async (input: {
  mailboxId: string;
  messageId: string;
}): Promise<ReceiveStageOutcome<"auto_label">> => {
  const [settings] = await db
    .select({
      autoLabelEnabled: mailboxAutomationSettings.autoLabelEnabled,
    })
    .from(mailboxAutomationSettings)
    .where(eq(mailboxAutomationSettings.mailboxId, input.mailboxId))
    .limit(1);

  if (!settings?.autoLabelEnabled) {
    return { reason: "disabled", status: "skipped" };
  }

  const owner = await getAutomationOwner(input.mailboxId);
  if (!owner) {
    return { reason: "no_owner", status: "skipped" };
  }

  const entitlement = await hasUserBillingFeature({
    feature: "gmailAutomation",
    organizationId: owner.organizationId,
    userId: owner.userId,
  });
  if (!entitlement.hasAccess) {
    return { reason: "not_entitled", status: "skipped" };
  }

  const pendingAutoLabelIds = await listPendingManagedAutoLabelMessageIds({
    mailboxId: input.mailboxId,
    organizationId: owner.organizationId,
    userId: owner.userId,
  });
  const context = {
    autoLabelContext: await getManagedAutoLabelCandidates({
      mailboxId: input.mailboxId,
      userId: owner.userId,
    }),
    mailboxId: input.mailboxId,
    organizationId: owner.organizationId,
    userId: owner.userId,
  };
  const received = runReceiveStage({
    execute: async (identity) =>
      await processManagedAutoLabelMessage({ ...context, ...identity }),
    identity: { mailboxId: input.mailboxId, messageId: input.messageId },
    stage: "auto_label",
  });
  await Promise.all([
    received,
    ...[...new Set(pendingAutoLabelIds)]
      .filter((messageId) => messageId !== input.messageId)
      .map(
        async (messageId) =>
          await runReceiveStage({
            execute: async (identity) =>
              await processManagedAutoLabelMessage({ ...context, ...identity }),
            identity: { mailboxId: input.mailboxId, messageId },
            stage: "auto_label",
          })
      ),
  ]);
  await reportPendingManagedAutoLabelUsage(input.mailboxId, owner.userId);
  return await received;
};

export const getManagedAutomationOwner = getAutomationOwner;
