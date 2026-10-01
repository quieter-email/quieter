import { randomUUID } from "node:crypto";

import { chatModelSchema } from "@quieter/ai/chat-models";
import type { AiUsageReport } from "@quieter/ai/chat-usage";
import type { AutomationMailMessage } from "@quieter/ai/classify-gmail-message";
import {
  AUTO_LABEL_MODEL,
  detectMailVerificationCode,
} from "@quieter/ai/classify-gmail-message";
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
  lte,
  or,
  sql,
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
const RETRY_BASE_MS = 2 * 60_000;
const RETRY_MAX_MS = 30 * 60_000;
const COMBINED_CODE_MODEL = `${AUTO_LABEL_MODEL}+${VERIFICATION_CODE_MODEL}`;
const claimSelection = {
  attemptCount: mailboxVerificationCode.attemptCount,
  cacheWriteTokens: mailboxVerificationCode.cacheWriteTokens,
  cachedTokens: mailboxVerificationCode.cachedTokens,
  completionTokens: mailboxVerificationCode.completionTokens,
  costUsd: mailboxVerificationCode.costUsd,
  id: mailboxVerificationCode.id,
  model: mailboxVerificationCode.model,
  promptTokens: mailboxVerificationCode.promptTokens,
};

const accumulateVerificationCodeUsage = (
  previous: {
    cacheWriteTokens: number | null;
    cachedTokens: number | null;
    completionTokens: number | null;
    costUsd: number | null;
    promptTokens: number | null;
  },
  screenUsage: AiUsageReport | undefined,
  extractionUsage: AiUsageReport | undefined
) => ({
  cacheWriteTokens:
    (previous.cacheWriteTokens ?? 0) +
    (screenUsage?.cacheWriteTokens ?? 0) +
    (extractionUsage?.cacheWriteTokens ?? 0),
  cachedTokens:
    (previous.cachedTokens ?? 0) +
    (screenUsage?.cachedTokens ?? 0) +
    (extractionUsage?.cachedTokens ?? 0),
  completionTokens:
    (previous.completionTokens ?? 0) +
    (screenUsage?.completionTokens ?? 0) +
    (extractionUsage?.completionTokens ?? 0),
  costUsd:
    previous.costUsd === null &&
    screenUsage?.costUsd === undefined &&
    extractionUsage?.costUsd === undefined
      ? null
      : (previous.costUsd ?? 0) +
        (screenUsage?.costUsd ?? 0) +
        (extractionUsage?.costUsd ?? 0),
  promptTokens:
    (previous.promptTokens ?? 0) +
    (screenUsage?.promptTokens ?? 0) +
    (extractionUsage?.promptTokens ?? 0),
});

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
        ),
        or(
          isNull(mailboxVerificationCode.nextAttemptAt),
          lte(mailboxVerificationCode.nextAttemptAt, now)
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
    .set({
      leaseToken: null,
      leaseUntil: null,
      processedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        isNull(mailboxVerificationCode.processedAt),
        lte(
          mailboxVerificationCode.createdAt,
          new Date(now.getTime() - 2 * 60 * 60_000)
        ),
        or(
          isNull(mailboxVerificationCode.leaseUntil),
          lt(mailboxVerificationCode.leaseUntil, now)
        )
      )
    );
  await db
    .delete(mailboxVerificationCode)
    .where(
      and(
        isNull(mailboxVerificationCode.encryptedCode),
        or(
          isNull(mailboxVerificationCode.costUsd),
          lte(mailboxVerificationCode.costUsd, 0),
          isNotNull(mailboxVerificationCode.usageReportedAt)
        ),
        lt(
          mailboxVerificationCode.createdAt,
          new Date(now.getTime() - 30 * 24 * 60 * 60_000)
        )
      )
    );
};

const reportVerificationCodeUsage = async (
  event: typeof mailboxVerificationCode.$inferSelect,
  userId: string
) => {
  const { model } = event;
  const extractionModel =
    model?.startsWith(`${AUTO_LABEL_MODEL}+`) === true
      ? model.slice(AUTO_LABEL_MODEL.length + 1)
      : model;
  if (
    event.usageReportedAt ||
    !event.processedAt ||
    model === null ||
    (model !== AUTO_LABEL_MODEL &&
      !chatModelSchema.safeParse(extractionModel).success) ||
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
      model,
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
  } catch (error) {
    reportError(error, {
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
  scope,
  userId,
}: {
  mailboxId: string;
  scope:
    | { mode: "threads"; threadIds: string[] }
    | { mode: "messages"; messageIds: string[] };
  userId: string;
}) => {
  await assertAccessibleMailbox({ mailboxId, userId });
  const ids = scope.mode === "threads" ? scope.threadIds : scope.messageIds;
  if (ids.length === 0) {
    return { items: [] };
  }
  if (ids.length > 100) {
    throw new Error("Too many verification code identifiers.");
  }

  const selection = {
    encryptedCode: mailboxVerificationCode.encryptedCode,
    expiresAt: mailboxVerificationCode.expiresAt,
    messageId: mailboxVerificationCode.messageId,
    service: mailboxVerificationCode.service,
    threadId: mailboxVerificationCode.threadId,
  };
  const rows =
    scope.mode === "threads"
      ? await db
          .selectDistinctOn([mailboxVerificationCode.threadId], selection)
          .from(mailboxVerificationCode)
          .where(
            and(
              eq(mailboxVerificationCode.mailboxId, mailboxId),
              inArray(mailboxVerificationCode.threadId, ids),
              isNotNull(mailboxVerificationCode.encryptedCode)
            )
          )
          .orderBy(
            mailboxVerificationCode.threadId,
            desc(
              sql`coalesce(${mailboxVerificationCode.receivedAt}, ${mailboxVerificationCode.createdAt})`
            ),
            desc(mailboxVerificationCode.id)
          )
          .limit(100)
      : await db
          .select(selection)
          .from(mailboxVerificationCode)
          .where(
            and(
              eq(mailboxVerificationCode.mailboxId, mailboxId),
              inArray(mailboxVerificationCode.messageId, ids),
              isNotNull(mailboxVerificationCode.encryptedCode)
            )
          )
          .limit(100);

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
      attemptCount: 0,
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
    .returning(claimSelection);
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
              ),
              or(
                isNull(mailboxVerificationCode.nextAttemptAt),
                lte(mailboxVerificationCode.nextAttemptAt, now)
              )
            )
          )
          .returning(claimSelection)
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

  let screenUsage: AiUsageReport | undefined;
  let extractionUsage: AiUsageReport | undefined;
  let extractionAttempted = false;
  try {
    const budget = await getMailAutomationAiBudgetStatus({
      organizationId,
      userId,
    });
    if (!budget.allowed) {
      const deferredAt = new Date();
      await db
        .update(mailboxVerificationCode)
        .set({
          leaseToken: null,
          leaseUntil: null,
          nextAttemptAt: new Date(deferredAt.getTime() + RETRY_MAX_MS),
          updatedAt: deferredAt,
        })
        .where(
          and(
            eq(mailboxVerificationCode.id, claimed.id),
            eq(mailboxVerificationCode.leaseToken, leaseToken)
          )
        );
      return;
    }

    const message = await loadMessage();
    if (message && message.id !== messageId) {
      throw new Error("Verification code message identity mismatch.");
    }
    if (!message?.threadId) {
      const finishedAt = new Date();
      await db
        .update(mailboxVerificationCode)
        .set({
          leaseToken: null,
          leaseUntil: null,
          ...(message === null ? { processedAt: finishedAt } : {}),
          updatedAt: finishedAt,
        })
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

    let probability: number | undefined;
    try {
      probability = await detectMailVerificationCode({
        message,
        onUsage: (reported) => {
          screenUsage = reported;
        },
      });
    } catch (error) {
      reportError(error, {
        operation: "verification-code:screen",
      });
    }
    const extractCode = probability === undefined || probability >= 0.2;
    extractionAttempted = extractCode;
    const model =
      extractCode ||
      (claimed.model !== null && claimed.model !== AUTO_LABEL_MODEL)
        ? COMBINED_CODE_MODEL
        : AUTO_LABEL_MODEL;
    const candidate = extractCode
      ? await extractMailVerificationCode({
          message,
          model: VERIFICATION_CODE_MODEL,
          onUsage: (reported) => {
            extractionUsage = reported;
          },
        })
      : { code: null, expiresInSeconds: null, service: null };
    const usage = accumulateVerificationCodeUsage(
      claimed,
      screenUsage,
      extractionUsage
    );
    const detail = validateVerificationCodeCandidate({
      candidate,
      message,
      now: new Date(),
    });
    const internalDate = Number(message.internalDate);
    const receivedAt = new Date(
      Number.isFinite(internalDate) && internalDate > 0
        ? internalDate
        : Date.parse(message.date ?? "")
    );
    const finishedAt = new Date();
    const [saved] = await db
      .update(mailboxVerificationCode)
      .set({
        cacheWriteTokens: usage.cacheWriteTokens,
        cachedTokens: usage.cachedTokens,
        completionTokens: usage.completionTokens,
        costUsd: usage.costUsd,
        encryptedCode: detail ? encryptVerificationCode(detail.code) : null,
        expiresAt: detail?.expiresAt ?? null,
        leaseToken: null,
        leaseUntil: null,
        model,
        nextAttemptAt: null,
        processedAt: finishedAt,
        promptTokens: usage.promptTokens,
        receivedAt: detail ? receivedAt : null,
        service: detail?.service ?? null,
        threadId: detail ? message.threadId : null,
        updatedAt: finishedAt,
        usageReportedAt: usage.costUsd === null ? finishedAt : null,
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
    if (usage.costUsd !== null) {
      const [event] = await db
        .select()
        .from(mailboxVerificationCode)
        .where(eq(mailboxVerificationCode.id, claimed.id))
        .limit(1);
      if (event !== undefined) {
        await reportVerificationCodeUsage(event, userId);
      }
    }
  } catch (error) {
    reportError(error, {
      operation: "verification-code:extract",
    });
    const usage = accumulateVerificationCodeUsage(
      claimed,
      screenUsage,
      extractionUsage
    );
    const failedAt = new Date();
    const attemptCount = (claimed.attemptCount ?? 0) + 1;
    await db
      .update(mailboxVerificationCode)
      .set({
        ...(screenUsage !== undefined || extractionUsage !== undefined
          ? {
              ...usage,
              model:
                extractionAttempted ||
                (claimed.model !== null && claimed.model !== AUTO_LABEL_MODEL)
                  ? COMBINED_CODE_MODEL
                  : AUTO_LABEL_MODEL,
            }
          : {}),
        attemptCount,
        leaseToken: null,
        leaseUntil: null,
        nextAttemptAt: new Date(
          failedAt.getTime() +
            Math.min(
              RETRY_MAX_MS,
              RETRY_BASE_MS * 2 ** Math.min(attemptCount - 1, 20)
            )
        ),
        updatedAt: failedAt,
      })
      .where(
        and(
          eq(mailboxVerificationCode.id, claimed.id),
          eq(mailboxVerificationCode.leaseToken, leaseToken)
        )
      );
  }
};
