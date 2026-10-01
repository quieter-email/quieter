import { randomUUID } from "node:crypto";

import { chatModelSchema } from "@quieter/ai/chat-models";
import type { AiUsageReport } from "@quieter/ai/chat-usage";
import type { AutomationMailMessage } from "@quieter/ai/classify-gmail-message";
import { extractMailVerificationCode } from "@quieter/ai/extract-verification-code";
import { VERIFICATION_CODE_MODEL } from "@quieter/ai/model-config";
import { reportAiUsage } from "@quieter/billing";
import { db } from "@quieter/database/client";
import { mailboxVerificationCode } from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
} from "drizzle-orm";

import { getMailAutomationAiBudgetStatus } from "./mail-automation/ai-budget";
import { publishMailUpdate } from "./mail-updates";
import { assertAccessibleMailbox } from "./mailbox/service";
import {
  decryptVerificationCode,
  encryptVerificationCode,
} from "./verification-codes/crypto";
import {
  shouldInspectIncomingVerificationCode,
  validateVerificationCodeCandidate,
} from "./verification-codes/validation";

const LEASE_MS = 5 * 60_000;

export const listPendingMailboxVerificationCodeMessageIds = async (
  mailboxId: string,
  limit = 100
) => {
  const now = new Date();
  const rows = await db
    .select({ messageId: mailboxVerificationCode.messageId })
    .from(mailboxVerificationCode)
    .where(
      and(
        eq(mailboxVerificationCode.mailboxId, mailboxId),
        isNull(mailboxVerificationCode.processedAt),
        gt(
          mailboxVerificationCode.createdAt,
          new Date(now.getTime() - 2 * 60 * 60_000)
        ),
        or(
          isNull(mailboxVerificationCode.leaseUntil),
          lt(mailboxVerificationCode.leaseUntil, now)
        )
      )
    )
    .orderBy(asc(mailboxVerificationCode.createdAt))
    .limit(Math.max(0, Math.min(limit, 100)));
  return rows.map((row) => row.messageId);
};

export const cleanupMailboxVerificationCodes = async () => {
  const now = new Date();
  await db
    .update(mailboxVerificationCode)
    .set({ encryptedCode: null, updatedAt: now })
    .where(
      and(
        isNotNull(mailboxVerificationCode.encryptedCode),
        lt(mailboxVerificationCode.expiresAt, now)
      )
    );
  await db
    .delete(mailboxVerificationCode)
    .where(
      lt(
        mailboxVerificationCode.createdAt,
        new Date(now.getTime() - 30 * 24 * 60 * 60_000)
      )
    );
};

const reportVerificationCodeUsage = async (
  event: typeof mailboxVerificationCode.$inferSelect,
  userId: string
) => {
  const model = chatModelSchema.safeParse(event.model);
  if (
    event.usageReportedAt ||
    !event.processedAt ||
    !model.success ||
    event.costUsd === null ||
    event.promptTokens === null ||
    event.completionTokens === null
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
      usageKind: "verificationCode",
      userId,
    });
    await db
      .update(mailboxVerificationCode)
      .set({ updatedAt: new Date(), usageReportedAt: new Date() })
      .where(eq(mailboxVerificationCode.id, event.id));
  } catch {
    reportError(new Error("Verification code usage reporting failed."), {
      operation: "verification-code:report-usage",
    });
  }
};

export const reportPendingMailboxVerificationCodeUsage = async (
  mailboxId: string,
  userId: string
) => {
  const events = await db
    .select()
    .from(mailboxVerificationCode)
    .where(
      and(
        eq(mailboxVerificationCode.mailboxId, mailboxId),
        isNotNull(mailboxVerificationCode.processedAt),
        isNotNull(mailboxVerificationCode.costUsd),
        isNull(mailboxVerificationCode.usageReportedAt)
      )
    )
    .orderBy(asc(mailboxVerificationCode.createdAt))
    .limit(100);
  for (const event of events) {
    await reportVerificationCodeUsage(event, userId);
  }
};

export const listVerificationCodes = async ({
  mailboxId,
  threadIds,
  userId,
}: {
  mailboxId: string;
  threadIds: string[];
  userId: string;
}) => {
  await assertAccessibleMailbox({ mailboxId, userId });
  if (threadIds.length === 0) {
    return { items: [] };
  }

  const rows = await db
    .select({
      encryptedCode: mailboxVerificationCode.encryptedCode,
      expiresAt: mailboxVerificationCode.expiresAt,
      messageId: mailboxVerificationCode.messageId,
      service: mailboxVerificationCode.service,
      threadId: mailboxVerificationCode.threadId,
    })
    .from(mailboxVerificationCode)
    .where(
      and(
        eq(mailboxVerificationCode.mailboxId, mailboxId),
        inArray(mailboxVerificationCode.threadId, threadIds),
        gt(mailboxVerificationCode.expiresAt, new Date())
      )
    )
    .orderBy(desc(mailboxVerificationCode.createdAt));

  return {
    items: rows.flatMap((row) =>
      row.encryptedCode && row.expiresAt && row.threadId
        ? [
            {
              code: decryptVerificationCode(row.encryptedCode),
              expiresAt: row.expiresAt,
              messageId: row.messageId,
              service: row.service,
              threadId: row.threadId,
            },
          ]
        : []
    ),
  };
};

export const processMailVerificationCode = async ({
  loadMessage,
  mailboxId,
  messageId,
  organizationId,
  userId,
}: {
  loadMessage: () => Promise<AutomationMailMessage | null>;
  mailboxId: string;
  messageId: string;
  organizationId?: string | null;
  userId: string;
}) => {
  const now = new Date();
  const leaseToken = randomUUID();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const [created] = await db
    .insert(mailboxVerificationCode)
    .values({
      createdAt: now,
      id: randomUUID(),
      leaseToken,
      leaseUntil,
      mailboxId,
      messageId,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [
        mailboxVerificationCode.mailboxId,
        mailboxVerificationCode.messageId,
      ],
    })
    .returning({ id: mailboxVerificationCode.id });
  const [claimed] =
    created === undefined
      ? await db
          .update(mailboxVerificationCode)
          .set({ leaseToken, leaseUntil, updatedAt: now })
          .where(
            and(
              eq(mailboxVerificationCode.mailboxId, mailboxId),
              eq(mailboxVerificationCode.messageId, messageId),
              isNull(mailboxVerificationCode.processedAt),
              or(
                isNull(mailboxVerificationCode.leaseUntil),
                lt(mailboxVerificationCode.leaseUntil, now)
              )
            )
          )
          .returning({ id: mailboxVerificationCode.id })
      : [created];
  if (claimed === undefined) {
    const [pendingUsage] = await db
      .select()
      .from(mailboxVerificationCode)
      .where(
        and(
          eq(mailboxVerificationCode.mailboxId, mailboxId),
          eq(mailboxVerificationCode.messageId, messageId),
          isNull(mailboxVerificationCode.usageReportedAt)
        )
      )
      .limit(1);
    if (pendingUsage !== undefined) {
      await reportVerificationCodeUsage(pendingUsage, userId);
    }
    return;
  }

  try {
    const [message, budget] = await Promise.all([
      loadMessage(),
      getMailAutomationAiBudgetStatus({ organizationId, userId }),
    ]);
    if (message && message.id !== messageId) {
      throw new Error("Verification code message identity mismatch.");
    }
    if (!message?.threadId) {
      await db
        .update(mailboxVerificationCode)
        .set({ leaseToken: null, leaseUntil: null, updatedAt: new Date() })
        .where(
          and(
            eq(mailboxVerificationCode.id, claimed.id),
            eq(mailboxVerificationCode.leaseToken, leaseToken)
          )
        );
      return;
    }
    if (!shouldInspectIncomingVerificationCode(message, new Date())) {
      await db
        .update(mailboxVerificationCode)
        .set({
          leaseToken: null,
          leaseUntil: null,
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mailboxVerificationCode.id, claimed.id),
            eq(mailboxVerificationCode.leaseToken, leaseToken)
          )
        );
      return;
    }

    if (!budget.allowed) {
      await db
        .update(mailboxVerificationCode)
        .set({ leaseToken: null, leaseUntil: null, updatedAt: new Date() })
        .where(
          and(
            eq(mailboxVerificationCode.id, claimed.id),
            eq(mailboxVerificationCode.leaseToken, leaseToken)
          )
        );
      return;
    }

    const model = VERIFICATION_CODE_MODEL;
    let usage: AiUsageReport | undefined;
    const candidate = await extractMailVerificationCode({
      message,
      model,
      onUsage: (reported) => {
        usage = reported;
      },
    });
    const detail = validateVerificationCodeCandidate({
      candidate,
      message,
      now: new Date(),
    });
    const finishedAt = new Date();
    const [saved] = await db
      .update(mailboxVerificationCode)
      .set({
        cacheWriteTokens: usage?.cacheWriteTokens ?? null,
        cachedTokens: usage?.cachedTokens ?? null,
        completionTokens: usage?.completionTokens ?? null,
        costUsd: usage?.costUsd ?? null,
        encryptedCode: detail ? encryptVerificationCode(detail.code) : null,
        expiresAt: detail?.expiresAt ?? null,
        leaseToken: null,
        leaseUntil: null,
        model,
        processedAt: finishedAt,
        promptTokens: usage?.promptTokens ?? null,
        service: detail?.service ?? null,
        threadId: detail ? message.threadId : null,
        updatedAt: finishedAt,
        usageReportedAt: usage?.costUsd === undefined ? finishedAt : null,
      })
      .where(
        and(
          eq(mailboxVerificationCode.id, claimed.id),
          eq(mailboxVerificationCode.leaseToken, leaseToken)
        )
      )
      .returning({ id: mailboxVerificationCode.id });
    if (saved === undefined) {
      return;
    }
    if (detail) {
      await publishMailUpdate({ mailboxId, type: "mailbox.changed" });
    }
    if (usage?.costUsd !== undefined) {
      const [event] = await db
        .select()
        .from(mailboxVerificationCode)
        .where(eq(mailboxVerificationCode.id, claimed.id))
        .limit(1);
      if (event !== undefined) {
        await reportVerificationCodeUsage(event, userId);
      }
    }
  } catch {
    await db
      .update(mailboxVerificationCode)
      .set({ leaseToken: null, leaseUntil: null, updatedAt: new Date() })
      .where(
        and(
          eq(mailboxVerificationCode.id, claimed.id),
          eq(mailboxVerificationCode.leaseToken, leaseToken)
        )
      );
    reportError(new Error("Verification code extraction failed."), {
      operation: "verification-code:extract",
    });
  }
};
