import type { ChatMiddleware } from "@tanstack/ai";
import { chatModelSchema, type ChatModel } from "@quieter/ai/chat-models";
import {
  classifyMailMessage,
  type AutomationMailMessage,
  type MailAutoLabelCandidate,
} from "@quieter/ai/classify-gmail-message";
import { reportAiUsage } from "@quieter/billing";
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
import { MAILBOX_LABELS } from "@quieter/gmail";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  listPendingGmailUsefulDetailMessageIds,
  processGmailUsefulDetailMessage,
  reportPendingGmailUsefulDetailUsage,
} from "../gmail-useful-details/service";
import { getMailAutomationAiBudgetStatus } from "../mail-automation/ai-budget";
import { deferAutoLabelAutomation } from "../mail-automation/auto-label-events";
import {
  loadAutoLabelUserCorrectionPrompt,
  loadAutomationMemoryPrompt,
} from "../mail-automation/memory";
import { loadUserAiConfiguration } from "../user-ai-context";
import { updateManagedMessageLabelAssignments } from "./labels/repository";

const AUTO_LABEL_RETRY_BASE_MS = 1000 * 60 * 5;
const AUTO_LABEL_RETRY_MAX_MS = 1000 * 60 * 60 * 24;

type ManagedAutoLabelContext = {
  availableLabelIds: Set<string>;
  labels: MailAutoLabelCandidate[];
  memoryProfile: string | null;
  model: ChatModel;
  userAiContext: string | null;
  userCorrectionContext: string | null;
};

const toAutomationMessage = (
  message: typeof managedMailMessage.$inferSelect,
  attachments: Array<{ fileName: string; mimeType: string }>,
): AutomationMailMessage => ({
  attachments,
  bodyHtml: message.bodyHtml,
  bodyText: message.bodyText,
  from: message.from,
  id: message.id,
  internalDate: String(message.sentAt.getTime()),
  labelIds:
    message.direction === "inbound" && message.mailboxState === "active"
      ? [MAILBOX_LABELS.inbox, ...(!message.isRead ? [MAILBOX_LABELS.unread] : [])]
      : [],
  snippet: message.snippet,
  subject: message.subject,
  threadId: message.threadId,
  to: message.to,
});

const loadManagedAutomationMessage = async (mailboxId: string, messageId: string) => {
  const [message] = await db
    .select()
    .from(managedMailMessage)
    .where(and(eq(managedMailMessage.mailboxId, mailboxId), eq(managedMailMessage.id, messageId)))
    .limit(1);
  if (!message || message.direction !== "inbound" || message.mailboxState !== "active") {
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
  const labels = await db
    .select({
      description: managedMailLabel.description,
      id: managedMailLabel.id,
      name: managedMailLabel.name,
    })
    .from(managedMailLabel)
    .where(eq(managedMailLabel.mailboxId, input.mailboxId));

  const candidates = labels.map((label) => ({
    description: label.description,
    id: label.id,
    inclusionCriteria: null,
    name: label.name,
  }));
  const [memoryProfile, aiConfiguration, userCorrectionContext] = await Promise.all([
    loadAutomationMemoryPrompt({
      agent: "auto_label",
      mailboxId: input.mailboxId,
    }),
    loadUserAiConfiguration({ userId: input.userId }),
    loadAutoLabelUserCorrectionPrompt(input.mailboxId),
  ]);

  return {
    availableLabelIds: new Set(candidates.map((label) => label.id)),
    labels: candidates,
    memoryProfile,
    model: aiConfiguration.autoLabelModel,
    userAiContext: aiConfiguration.markdown,
    userCorrectionContext,
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

  return record?.billingOwnerUserId
    ? { organizationId: record.organizationId, userId: record.billingOwnerUserId }
    : null;
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message.slice(0, 2_000) : "Unknown managed mail automation error.";

const getOrCreateManagedAutoLabelEvent = async (mailboxId: string, messageId: string) => {
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
        eq(gmailAutoLabelEvent.gmailMessageId, messageId),
      ),
    )
    .limit(1);

  if (!event) {
    throw new Error("Could not create managed auto-label event.");
  }

  return event;
};

const markManagedAutoLabelEventAppliedWithoutUsage = async (eventId: string) => {
  const now = new Date();
  await db
    .update(gmailAutoLabelEvent)
    .set({
      appliedAt: now,
      labelIds: [],
      lastError: null,
      nextAttemptAt: null,
      updatedAt: now,
      usageReportedAt: now,
    })
    .where(eq(gmailAutoLabelEvent.id, eventId));
};

const reportManagedAutoLabelUsage = async (event: {
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  id: string;
  mailboxId: string;
  model: string | null;
  promptTokens: number | null;
  usageReportedAt: Date | null;
  userId: string;
}) => {
  const model = chatModelSchema.safeParse(event.model);
  if (
    event.usageReportedAt ||
    !model.success ||
    event.promptTokens == null ||
    event.completionTokens == null ||
    event.costUsd == null
  ) {
    return;
  }

  try {
    await reportAiUsage({
      costUsd: event.costUsd,
      completionTokens: event.completionTokens,
      externalId: event.id,
      mailboxId: event.mailboxId,
      model: model.data,
      promptTokens: event.promptTokens,
      promptTokensDetails: {
        cachedTokens: event.cachedTokens ?? 0,
        cacheWriteTokens: event.cacheWriteTokens ?? 0,
      },
      usageKind: "autoLabel",
      userId: event.userId,
    });
    await db
      .update(gmailAutoLabelEvent)
      .set({
        lastError: null,
        updatedAt: new Date(),
        usageReportedAt: new Date(),
      })
      .where(eq(gmailAutoLabelEvent.id, event.id));
  } catch (error) {
    await db
      .update(gmailAutoLabelEvent)
      .set({
        lastError: `AI usage reporting failed: ${getErrorMessage(error)}`,
        updatedAt: new Date(),
      })
      .where(eq(gmailAutoLabelEvent.id, event.id));
  }
};

const processManagedAutoLabelMessage = async (input: {
  autoLabelContext: ManagedAutoLabelContext;
  mailboxId: string;
  messageId: string;
  organizationId: string;
  userId: string;
}) => {
  let event = await getOrCreateManagedAutoLabelEvent(input.mailboxId, input.messageId);
  if (event.appliedAt) {
    await reportManagedAutoLabelUsage({ ...event, userId: input.userId });
    return;
  }

  try {
    if (event.labelIds == null) {
      if (input.autoLabelContext.labels.length === 0) {
        await markManagedAutoLabelEventAppliedWithoutUsage(event.id);
        return;
      }

      const message = await loadManagedAutomationMessage(input.mailboxId, input.messageId);
      if (!message) {
        await markManagedAutoLabelEventAppliedWithoutUsage(event.id);
        return;
      }

      let promptTokens = 0;
      let completionTokens = 0;
      let costUsd: number | undefined = 0;
      let cachedTokens = 0;
      let cacheWriteTokens = 0;
      const usageMiddleware: ChatMiddleware = {
        name: "managed-auto-label-usage",
        onUsage: (_context, usage) => {
          promptTokens += usage.promptTokens;
          completionTokens += usage.completionTokens;
          costUsd =
            costUsd === undefined || usage.cost === undefined ? undefined : costUsd + usage.cost;
          cachedTokens += usage.promptTokensDetails?.cachedTokens ?? 0;
          cacheWriteTokens += usage.promptTokensDetails?.cacheWriteTokens ?? 0;
        },
      };
      const budgetStatus = await getMailAutomationAiBudgetStatus({
        organizationId: input.organizationId,
        userId: input.userId,
      });
      if (!budgetStatus.allowed) {
        await deferAutoLabelAutomation(event.id, budgetStatus.message);
        return;
      }

      const labelIds = await classifyMailMessage({
        labels: input.autoLabelContext.labels,
        memoryProfile: input.autoLabelContext.memoryProfile,
        message,
        middleware: [usageMiddleware],
        model: input.autoLabelContext.model,
        userAiContext: input.autoLabelContext.userAiContext,
        userCorrectionContext: input.autoLabelContext.userCorrectionContext,
      });
      const [classified] = await db
        .update(gmailAutoLabelEvent)
        .set({
          cachedTokens,
          cacheWriteTokens,
          completionTokens,
          costUsd: costUsd ?? null,
          labelIds,
          lastError: null,
          model: input.autoLabelContext.model,
          promptTokens,
          updatedAt: new Date(),
        })
        .where(eq(gmailAutoLabelEvent.id, event.id))
        .returning();
      event = classified ?? event;
    }

    const labelIds = (event.labelIds ?? []).filter((labelId) =>
      input.autoLabelContext.availableLabelIds.has(labelId),
    );

    const currentMessage =
      labelIds.length > 0
        ? await loadManagedAutomationMessage(input.mailboxId, input.messageId)
        : null;

    if (labelIds.length > 0 && currentMessage) {
      await updateManagedMessageLabelAssignments({
        addLabelIds: labelIds,
        mailboxId: input.mailboxId,
        messageIds: [input.messageId],
        source: "ai_auto_label",
      });
    }

    const now = new Date();
    await db
      .update(gmailAutoLabelEvent)
      .set({
        appliedAt: now,
        lastError: null,
        nextAttemptAt: null,
        updatedAt: now,
      })
      .where(eq(gmailAutoLabelEvent.id, event.id));
    await reportManagedAutoLabelUsage({ ...event, userId: input.userId });
  } catch (error) {
    const now = new Date();
    const attemptCount = event.attemptCount + 1;
    await db
      .update(gmailAutoLabelEvent)
      .set({
        attemptCount,
        lastError: getErrorMessage(error),
        nextAttemptAt: new Date(
          now.getTime() +
            Math.min(AUTO_LABEL_RETRY_MAX_MS, AUTO_LABEL_RETRY_BASE_MS * 2 ** (attemptCount - 1)),
        ),
        updatedAt: now,
      })
      .where(eq(gmailAutoLabelEvent.id, event.id));
    console.error(
      `Could not auto-label managed message ${input.messageId} for mailbox ${input.mailboxId}.`,
      getErrorMessage(error),
    );
  }
};

const listPendingManagedAutoLabelMessageIds = async (mailboxId: string) => {
  const now = new Date();
  const events = await db
    .select({ messageId: gmailAutoLabelEvent.gmailMessageId })
    .from(gmailAutoLabelEvent)
    .where(
      and(
        eq(gmailAutoLabelEvent.mailboxId, mailboxId),
        isNull(gmailAutoLabelEvent.appliedAt),
        or(isNull(gmailAutoLabelEvent.nextAttemptAt), lte(gmailAutoLabelEvent.nextAttemptAt, now)),
      ),
    )
    .limit(20);

  return events.map((event) => event.messageId);
};

const reportPendingManagedAutoLabelUsage = async (mailboxId: string, userId: string) => {
  const events = await db
    .select({
      cachedTokens: gmailAutoLabelEvent.cachedTokens,
      cacheWriteTokens: gmailAutoLabelEvent.cacheWriteTokens,
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
        isNull(gmailAutoLabelEvent.usageReportedAt),
      ),
    )
    .limit(100);

  for (const event of events) {
    await reportManagedAutoLabelUsage({ ...event, mailboxId, userId });
  }
};

const processManagedAutomationMessageIds = async (input: {
  autoLabelEnabled: boolean;
  getAutoLabelContext: () => Promise<ManagedAutoLabelContext>;
  mailboxId: string;
  messageIds: string[];
  organizationId: string;
  usefulDetailsEnabled: boolean;
  userId: string;
}) => {
  if ((!input.autoLabelEnabled && !input.usefulDetailsEnabled) || input.messageIds.length === 0) {
    return;
  }

  const autoLabelContext = input.autoLabelEnabled ? await input.getAutoLabelContext() : null;

  for (const messageId of input.messageIds) {
    let messagePromise: Promise<AutomationMailMessage | null> | null = null;
    const loadMessage = async () => {
      messagePromise ??= loadManagedAutomationMessage(input.mailboxId, messageId);
      return await messagePromise;
    };

    await Promise.all([
      autoLabelContext
        ? processManagedAutoLabelMessage({
            autoLabelContext,
            mailboxId: input.mailboxId,
            messageId,
            organizationId: input.organizationId,
            userId: input.userId,
          })
        : Promise.resolve(),
      input.usefulDetailsEnabled
        ? processGmailUsefulDetailMessage({
            gmailMessageId: messageId,
            loadMessage,
            mailboxId: input.mailboxId,
            organizationId: input.organizationId,
            userId: input.userId,
          })
        : Promise.resolve(),
    ]);
  }
};

export const processManagedMailAutomation = async (input: {
  mailboxId: string;
  messageId: string;
}) => {
  const [settings] = await db
    .select({
      autoLabelEnabled: mailboxAutomationSettings.autoLabelEnabled,
      usefulDetailsEnabled: mailboxAutomationSettings.usefulDetailsEnabled,
    })
    .from(mailboxAutomationSettings)
    .where(eq(mailboxAutomationSettings.mailboxId, input.mailboxId))
    .limit(1);

  if (!settings?.autoLabelEnabled && !settings?.usefulDetailsEnabled) {
    return;
  }

  const owner = await getAutomationOwner(input.mailboxId);
  if (!owner) return;

  const entitlement = await hasUserBillingFeature({
    feature: "gmailAutomation",
    organizationId: owner.organizationId,
    userId: owner.userId,
  });
  if (!entitlement.hasAccess) return;

  const [pendingAutoLabelIds, pendingUsefulDetailIds] = await Promise.all([
    settings.autoLabelEnabled ? listPendingManagedAutoLabelMessageIds(input.mailboxId) : [],
    settings.usefulDetailsEnabled ? listPendingGmailUsefulDetailMessageIds(input.mailboxId) : [],
  ]);
  let autoLabelContextPromise: Promise<ManagedAutoLabelContext> | null = null;
  const getAutoLabelContext = () => {
    autoLabelContextPromise ??= getManagedAutoLabelCandidates({
      mailboxId: input.mailboxId,
      userId: owner.userId,
    });
    return autoLabelContextPromise;
  };

  await processManagedAutomationMessageIds({
    autoLabelEnabled: settings.autoLabelEnabled,
    getAutoLabelContext,
    mailboxId: input.mailboxId,
    messageIds: Array.from(
      new Set([input.messageId, ...pendingAutoLabelIds, ...pendingUsefulDetailIds]),
    ),
    organizationId: owner.organizationId,
    usefulDetailsEnabled: settings.usefulDetailsEnabled,
    userId: owner.userId,
  });
  await Promise.all([
    reportPendingManagedAutoLabelUsage(input.mailboxId, owner.userId),
    reportPendingGmailUsefulDetailUsage(input.mailboxId, owner.userId),
  ]);
};
