import { randomUUID } from "node:crypto";

import { chatModelSchema } from "@quieter/ai/chat-models";
import type { ChatModel } from "@quieter/ai/chat-models";
import type { AiUsageReport } from "@quieter/ai/chat-usage";
import { classifyMailMessage } from "@quieter/ai/classify-gmail-message";
import type {
  AutomationMailMessage,
  MailAutoLabelCandidate,
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
import { reportError } from "@quieter/observability";
import { and, eq, isNull, lte, or } from "drizzle-orm";

import {
  buildMailMemoryQuery,
  loadAiAgentMemoryCandidates,
  loadAiConfiguration,
  rankAiAgentMemoryCandidates,
  serializeAiAgentContext,
} from "../ai-memory";
import type { AiAgentMemoryCandidates } from "../ai-memory";
import {
  listPendingGmailUsefulDetailMessageIds,
  processGmailUsefulDetailMessage,
  reportPendingGmailUsefulDetailUsage,
} from "../gmail-useful-details/service";
import { getMailAutomationAiBudgetStatus } from "../mail-automation/ai-budget";
import { deferAutoLabelAutomation } from "../mail-automation/auto-label-events";
import { hasText } from "../text";
import { updateManagedMessageLabelAssignments } from "./labels/repository";

const AUTO_LABEL_RETRY_BASE_MS = 1000 * 60 * 5;
const AUTO_LABEL_RETRY_MAX_MS = 1000 * 60 * 60 * 24;

type ManagedAutoLabelContext = {
  availableLabelIds: Set<string>;
  labels: MailAutoLabelCandidate[];
  memoryCandidates: AiAgentMemoryCandidates;
  model: ChatModel;
};

const toAutomationMessage = (
  message: typeof managedMailMessage.$inferSelect,
  attachments: { fileName: string; mimeType: string }[]
): AutomationMailMessage => ({
  attachments,
  bodyHtml: message.bodyHtml,
  bodyText: message.bodyText,
  from: message.from,
  id: message.id,
  internalDate: String(message.sentAt.getTime()),
  labelIds:
    message.direction === "inbound" && message.mailboxState === "active"
      ? [
          MAILBOX_LABELS.inbox,
          ...(message.isRead ? [] : [MAILBOX_LABELS.unread]),
        ]
      : [],
  snippet: message.snippet,
  subject: message.subject,
  threadId: message.threadId,
  to: message.to,
});

const loadManagedAutomationMessage = async (
  mailboxId: string,
  messageId: string
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
    message.mailboxState !== "active"
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
  const [labels, aiConfiguration, memoryCandidates] = await Promise.all([
    db
      .select({
        description: managedMailLabel.description,
        id: managedMailLabel.id,
        name: managedMailLabel.name,
      })
      .from(managedMailLabel)
      .where(eq(managedMailLabel.mailboxId, input.mailboxId)),
    loadAiConfiguration({ userId: input.userId }),
    loadAiAgentMemoryCandidates({
      includeUserScope: false,
      mailboxId: input.mailboxId,
      userId: input.userId,
    }),
  ]);

  const candidates = labels.map((label) => ({
    description: label.description,
    id: label.id,
    inclusionCriteria: null,
    name: label.name,
  }));

  return {
    availableLabelIds: new Set(candidates.map((label) => label.id)),
    labels: candidates,
    memoryCandidates,
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

  if (record === undefined || !hasText(record.billingOwnerUserId)) {
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
    event.promptTokens === null ||
    event.promptTokens === undefined ||
    event.completionTokens === null ||
    event.completionTokens === undefined ||
    event.costUsd === null ||
    event.costUsd === undefined
  ) {
    return;
  }

  try {
    await reportAiUsage({
      completionTokens: event.completionTokens,
      costUsd: event.costUsd,
      externalId: event.id,
      mailboxId: event.mailboxId,
      model: model.data,
      promptTokens: event.promptTokens,
      promptTokensDetails: {
        cacheWriteTokens: event.cacheWriteTokens ?? 0,
        cachedTokens: event.cachedTokens ?? 0,
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
  let event = await getOrCreateManagedAutoLabelEvent(
    input.mailboxId,
    input.messageId
  );
  if (event.appliedAt) {
    await reportManagedAutoLabelUsage({ ...event, userId: input.userId });
    return;
  }

  try {
    if (event.labelIds === null || event.labelIds === undefined) {
      if (input.autoLabelContext.labels.length === 0) {
        await markManagedAutoLabelEventAppliedWithoutUsage(event.id);
        return;
      }

      const message = await loadManagedAutomationMessage(
        input.mailboxId,
        input.messageId
      );
      if (message === null) {
        await markManagedAutoLabelEventAppliedWithoutUsage(event.id);
        return;
      }

      let usage: AiUsageReport = {
        cacheWriteTokens: 0,
        cachedTokens: 0,
        completionTokens: 0,
        costUsd: undefined,
        promptTokens: 0,
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
        memoryContext: serializeAiAgentContext(
          await rankAiAgentMemoryCandidates({
            agent: "auto_label",
            candidates: input.autoLabelContext.memoryCandidates,
            query: buildMailMemoryQuery(message),
            semantic: false,
          })
        ),
        message,
        model: input.autoLabelContext.model,
        onUsage: (reportedUsage) => {
          usage = reportedUsage;
        },
      });
      const [classified] = await db
        .update(gmailAutoLabelEvent)
        .set({
          cacheWriteTokens: usage.cacheWriteTokens,
          cachedTokens: usage.cachedTokens,
          completionTokens: usage.completionTokens,
          costUsd: usage.costUsd ?? null,
          labelIds,
          lastError: null,
          model: input.autoLabelContext.model,
          promptTokens: usage.promptTokens,
          updatedAt: new Date(),
        })
        .where(eq(gmailAutoLabelEvent.id, event.id))
        .returning();
      event = classified ?? event;
    }

    const labelIds = (event.labelIds ?? []).filter((labelId) =>
      input.autoLabelContext.availableLabelIds.has(labelId)
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
            Math.min(
              AUTO_LABEL_RETRY_MAX_MS,
              AUTO_LABEL_RETRY_BASE_MS * 2 ** (attemptCount - 1)
            )
        ),
        updatedAt: now,
      })
      .where(eq(gmailAutoLabelEvent.id, event.id));
    reportError(error, { operation: "managed-mail:auto-label-message" });
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
        or(
          isNull(gmailAutoLabelEvent.nextAttemptAt),
          lte(gmailAutoLabelEvent.nextAttemptAt, now)
        )
      )
    )
    .limit(20);

  return events.map((event) => event.messageId);
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
      await reportManagedAutoLabelUsage({ ...event, mailboxId, userId });
    })
  );
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
  if (
    (!input.autoLabelEnabled && !input.usefulDetailsEnabled) ||
    input.messageIds.length === 0
  ) {
    return;
  }

  const autoLabelContext = input.autoLabelEnabled
    ? await input.getAutoLabelContext()
    : null;

  await Promise.all(
    input.messageIds.map(async (messageId) => {
      let messagePromise: Promise<AutomationMailMessage | null> | null = null;
      const loadMessage = async () => {
        messagePromise ??= loadManagedAutomationMessage(
          input.mailboxId,
          messageId
        );
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
    })
  );
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
  if (!owner) {
    return;
  }

  const entitlement = await hasUserBillingFeature({
    feature: "gmailAutomation",
    organizationId: owner.organizationId,
    userId: owner.userId,
  });
  if (!entitlement.hasAccess) {
    return;
  }

  const [pendingAutoLabelIds, pendingUsefulDetailIds] = await Promise.all([
    settings.autoLabelEnabled
      ? listPendingManagedAutoLabelMessageIds(input.mailboxId)
      : [],
    settings.usefulDetailsEnabled
      ? listPendingGmailUsefulDetailMessageIds(input.mailboxId)
      : [],
  ]);
  let autoLabelContextPromise: Promise<ManagedAutoLabelContext> | null = null;
  const getAutoLabelContext = async () => {
    autoLabelContextPromise ??= getManagedAutoLabelCandidates({
      mailboxId: input.mailboxId,
      userId: owner.userId,
    });
    return await autoLabelContextPromise;
  };

  await processManagedAutomationMessageIds({
    autoLabelEnabled: settings.autoLabelEnabled,
    getAutoLabelContext,
    mailboxId: input.mailboxId,
    messageIds: [
      ...new Set([
        input.messageId,
        ...pendingAutoLabelIds,
        ...pendingUsefulDetailIds,
      ]),
    ],
    organizationId: owner.organizationId,
    usefulDetailsEnabled: settings.usefulDetailsEnabled,
    userId: owner.userId,
  });
  await Promise.all([
    reportPendingManagedAutoLabelUsage(input.mailboxId, owner.userId),
    reportPendingGmailUsefulDetailUsage(input.mailboxId, owner.userId),
  ]);
};
