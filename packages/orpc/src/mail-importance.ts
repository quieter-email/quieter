import { createHash, randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import type { AiUsageReport } from "@quieter/ai/chat-usage";
import type { AutomationMailMessage } from "@quieter/ai/classify-gmail-message";
import { classifyMailImportance } from "@quieter/ai/mail-importance";
import { resolveBackgroundModel } from "@quieter/ai/model-config";
import { reportAiUsage } from "@quieter/billing";
import { db } from "@quieter/database/client";
import type { DatabaseExecutor } from "@quieter/database/client";
import {
  gmailCapturedMessage,
  mailbox,
  mailMessageImportance,
  mailImportanceAttempt,
  managedMailMessage,
  organization,
} from "@quieter/database/schema";
import { extractListUnsubscribeTargets } from "@quieter/gmail";
import type { CapturedMailSnapshot } from "@quieter/mail/capture";
import { mailCategorySchema } from "@quieter/mail/data-plane";
import type {
  MailMutationResult,
  MailMutationTarget,
  MailThreadSummary,
} from "@quieter/mail/data-plane";
import { isMessageInMailbox } from "@quieter/mail/messages";
import type {
  ListMessagesPageResult,
  MessageListItem,
} from "@quieter/mail/messages";
import type { MailSearchExpression } from "@quieter/mail/search-expression";
import { parseMailSearchExpression } from "@quieter/mail/search-expression";
import { getSenderAvatarUrls } from "@quieter/mail/sender-avatar";
import { getUnsubscribeKey } from "@quieter/mail/unsubscribe";
import { reportError } from "@quieter/observability";
import type { SQL } from "drizzle-orm";
import {
  and,
  asc,
  desc,
  lt,
  eq,
  ilike,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  gt,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import {
  buildMailMemoryQuery,
  loadAiAgentContext,
  recordAiMemoryEvent,
  serializeAiAgentContext,
} from "./ai-memory";
import { getMailboxMemoryActor } from "./ai-memory-capture";
import { getMailAutomationAiBudgetStatus } from "./mail-automation/ai-budget";
import { publishMailUpdate } from "./mail-updates";
import { assertAccessibleMailbox } from "./mailbox/service";
import {
  parseAbsoluteDate,
  parseRelativeDate,
} from "./managed-mail/search/normalization";

const CLASSIFIER_VERSION = "1";

const importanceMessage = (
  message: AutomationMailMessage | CapturedMailSnapshot
): AutomationMailMessage &
  Partial<Pick<CapturedMailSnapshot, "headers">> &
  Pick<
    MessageListItem,
    "unsubscribeKey" | "unsubscribeMailto" | "unsubscribeUrl"
  > => {
  if (!("providerRevision" in message)) {
    return message;
  }
  const header = new Map(
    message.headers.map((item) => [item.name.toLowerCase(), item.value])
  );
  const unsubscribe = extractListUnsubscribeTargets(
    header.get("list-unsubscribe")
  );
  return {
    ...message,
    cc: header.get("cc"),
    from: header.get("from"),
    snippet: (message.bodyText ?? "").slice(0, 2000),
    subject: header.get("subject"),
    to: header.get("to"),
    unsubscribeKey: getUnsubscribeKey(message.headers),
    unsubscribeMailto: unsubscribe.mailto,
    unsubscribeUrl: unsubscribe.url,
  };
};

type ImportanceSource = {
  mailboxId: string;
  messageId: string;
  threadId: string;
  receivedAt: Date;
  message: AutomationMailMessage | CapturedMailSnapshot;
};

const importanceWorkValues = (input: ImportanceSource) => {
  const message = importanceMessage(input.message);
  const contentHash = createHash("sha256")
    .update(
      JSON.stringify({
        attachments:
          message.attachments?.map(({ fileName, mimeType }) => ({
            fileName,
            mimeType,
          })) ?? [],
        bodyHtml: message.bodyHtml ?? null,
        bodyText: message.bodyText ?? null,
        cc: message.cc ?? null,
        from: message.from ?? null,
        snippet: message.snippet ?? null,
        subject: message.subject ?? null,
        to: message.to ?? null,
      })
    )
    .digest("hex");
  const now = new Date();
  return {
    classifierVersion: CLASSIFIER_VERSION,
    contentHash,
    createdAt: now,
    mailboxId: input.mailboxId,
    messageId: input.messageId,
    nextAttemptAt: now,
    receivedAt: input.receivedAt,
    state: "pending",
    threadId: input.threadId,
    updatedAt: now,
  } satisfies typeof mailMessageImportance.$inferInsert;
};

export const ensureMailImportanceWork = async (
  database: DatabaseExecutor,
  input: ImportanceSource
) => {
  const values = importanceWorkValues(input);
  const { contentHash, updatedAt: now } = values;
  await database
    .insert(mailMessageImportance)
    .values(values)
    .onConflictDoUpdate({
      set: {
        aiImportant: null,
        attemptCount: 0,
        classifierVersion: CLASSIFIER_VERSION,
        contentHash,
        lastError: null,
        leaseExpiresAt: null,
        leaseId: null,
        nextAttemptAt: now,
        receivedAt: input.receivedAt,
        state: "pending",
        threadId: input.threadId,
        updatedAt: now,
      },
      setWhere: sql`${mailMessageImportance.contentHash} <> ${contentHash} or ${mailMessageImportance.classifierVersion} <> ${CLASSIFIER_VERSION} or ${mailMessageImportance.state} = 'cancelled'`,
      target: [
        mailMessageImportance.mailboxId,
        mailMessageImportance.messageId,
      ],
    });
};

const loadImportanceSources = async (
  database: DatabaseExecutor,
  mailboxId: string,
  messageIds?: string[],
  threadIds?: string[]
): Promise<
  {
    message: ReturnType<typeof importanceMessage> & { threadId: string };
    incoming: boolean;
    eligible: boolean;
    receivedAt: Date;
  }[]
> => {
  const [gmail, managed] = await Promise.all([
    database
      .select()
      .from(gmailCapturedMessage)
      .where(
        and(
          eq(gmailCapturedMessage.mailboxId, mailboxId),
          isNull(gmailCapturedMessage.deletedAt),
          messageIds
            ? inArray(gmailCapturedMessage.messageId, messageIds)
            : undefined,
          threadIds
            ? inArray(
                sql<string>`${gmailCapturedMessage.snapshot}->>'threadId'`,
                threadIds
              )
            : undefined
        )
      ),
    database
      .select()
      .from(managedMailMessage)
      .where(
        and(
          eq(managedMailMessage.mailboxId, mailboxId),
          messageIds ? inArray(managedMailMessage.id, messageIds) : undefined,
          threadIds
            ? inArray(managedMailMessage.threadId, threadIds)
            : undefined
        )
      ),
  ]);
  return [
    ...gmail.flatMap(({ snapshot }) =>
      snapshot
        ? [
            {
              eligible: !snapshot.labelIds.some((label) =>
                ["SENT", "DRAFT", "SPAM", "TRASH"].includes(label)
              ),
              incoming:
                !snapshot.labelIds.includes("SENT") &&
                !snapshot.labelIds.includes("DRAFT"),
              message: {
                ...importanceMessage(snapshot),
                threadId: snapshot.threadId,
              },
              receivedAt: new Date(Number(snapshot.internalDate) || Date.now()),
            },
          ]
        : []
    ),
    ...managed.map((message) => {
      let stateLabel = message.mailboxState.toUpperCase();
      if (message.mailboxState === "active") {
        stateLabel = message.direction === "inbound" ? "INBOX" : "SENT";
      } else if (message.mailboxState === "draft") {
        stateLabel = "DRAFT";
      }
      return {
        eligible:
          message.direction === "inbound" &&
          ["active", "archived"].includes(message.mailboxState),
        incoming: message.direction === "inbound",
        message: {
          ...message,
          labelIds: [stateLabel, ...(message.isRead ? [] : ["UNREAD"])],
        },
        receivedAt: message.sentAt,
      };
    }),
  ];
};

export const hydrateMailImportance = async <T extends MessageListItem>(
  mailboxId: string,
  messages: T[]
): Promise<
  (T & Pick<MessageListItem, "isImportant" | "threadIsImportant">)[]
> => {
  if (messages.length === 0) {
    return messages;
  }
  const threadIds = [...new Set(messages.map((message) => message.threadId))];
  const rows = await db
    .select()
    .from(mailMessageImportance)
    .where(
      and(
        eq(mailMessageImportance.mailboxId, mailboxId),
        inArray(mailMessageImportance.threadId, threadIds)
      )
    );
  const sources = await loadImportanceSources(
    db,
    mailboxId,
    rows.map((row) => row.messageId)
  );
  const eligible = new Set(
    sources.filter((source) => source.eligible).map(({ message }) => message.id)
  );
  const byId = new Map(
    rows.map((row) => [
      row.messageId,
      row.manualImportant ?? row.aiImportant ?? false,
    ])
  );
  const importantThreads = new Set(
    rows
      .filter(
        (row) =>
          eligible.has(row.messageId) &&
          (row.manualImportant ?? row.aiImportant ?? false)
      )
      .map((row) => row.threadId)
  );
  return messages.map((message) => ({
    ...message,
    isImportant: eligible.has(message.id) && (byId.get(message.id) ?? false),
    threadIsImportant: importantThreads.has(message.threadId),
  }));
};

export const setMailImportance = async (input: {
  actorUserId: string;
  mailboxId: string;
  targets: MailMutationTarget[];
  important: boolean;
}): Promise<MailMutationResult> => {
  const selected = await assertAccessibleMailbox({
    mailboxId: input.mailboxId,
    userId: input.actorUserId,
  });
  if (!selected.capabilities.canSetImportance) {
    throw new ORPCError("FORBIDDEN", {
      message: "You cannot change importance in this mailbox.",
    });
  }
  const result = await db.transaction(async (tx) => {
    const sources = await loadImportanceSources(
      tx,
      input.mailboxId,
      undefined,
      input.targets.map((target) => target.threadId)
    );
    const byId = new Map(sources.map((source) => [source.message.id, source]));
    const targets: MailMutationResult["targets"] = [];
    const appliedIds = new Set<string>();
    for (const target of input.targets) {
      const targetIds = target.messageIds.length
        ? [...new Set(target.messageIds)]
        : sources
            .filter((source) => source.message.threadId === target.threadId)
            .map((source) => source.message.id);
      const applicableIds = targetIds.filter(
        (id) => byId.get(id)?.incoming === true
      );
      if (
        applicableIds.length === 0 ||
        !targetIds.every(
          (id) => byId.get(id)?.message.threadId === target.threadId
        )
      ) {
        targets.push({
          code: "permission_denied",
          message: "Message is no longer available in this thread.",
          status: "failed",
          threadId: target.threadId,
        });
        continue;
      }
      for (const id of applicableIds) {
        appliedIds.add(id);
      }
      targets.push({ status: "applied", threadId: target.threadId });
    }
    if (appliedIds.size === 0) {
      return { sources: [], syncToken: undefined, targets };
    }
    const appliedSources = sources
      .filter((source) => appliedIds.has(source.message.id))
      .toSorted((left, right) =>
        left.message.id.localeCompare(right.message.id)
      );
    for (const source of appliedSources) {
      await tx
        .insert(mailMessageImportance)
        .values(
          importanceWorkValues({
            mailboxId: input.mailboxId,
            message: source.message,
            messageId: source.message.id,
            receivedAt: source.receivedAt,
            threadId: source.message.threadId,
          })
        )
        .onConflictDoNothing();
      await tx
        .update(mailMessageImportance)
        .set({
          manualActorUserId: input.actorUserId,
          manualImportant: input.important,
          manualUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mailMessageImportance.mailboxId, input.mailboxId),
            eq(mailMessageImportance.messageId, source.message.id)
          )
        );
    }
    const [revision] = await tx
      .update(mailbox)
      .set({
        contentRevision: sql`${mailbox.contentRevision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(mailbox.id, input.mailboxId))
      .returning({ value: mailbox.contentRevision });
    return {
      sources: appliedSources,
      syncToken: String(revision.value),
      targets,
    };
  });
  const appliedThreadIds = result.targets
    .filter((target) => target.status === "applied")
    .map((target) => target.threadId);
  const summaries: MailThreadSummary[] = [];
  if (appliedThreadIds.length) {
    const sources = await loadImportanceSources(
      db,
      input.mailboxId,
      undefined,
      appliedThreadIds
    );
    const messages = await hydrateMailImportance(
      input.mailboxId,
      sources.map(({ message, receivedAt }) => ({
        from: message.from ?? undefined,
        id: message.id,
        labelIds: message.labelIds,
        receivedAt: receivedAt.toISOString(),
        snippet: message.snippet ?? undefined,
        subject: message.subject ?? undefined,
        threadId: message.threadId,
        to: message.to ?? undefined,
      }))
    );
    for (const threadId of appliedThreadIds) {
      const members = messages.filter(
        (message) => message.threadId === threadId
      );
      const messageSummaries = members.map((message) => ({
        categories: mailCategorySchema.options.filter((category) =>
          isMessageInMailbox(
            { ...message, threadIsImportant: message.isImportant },
            category
          )
        ),
        id: message.id,
        isImportant: message.isImportant,
        isUnread: message.labelIds?.includes("UNREAD") ?? false,
      }));
      summaries.push({
        attachmentCount: sources
          .filter((source) => source.message.threadId === threadId)
          .reduce(
            (count, source) =>
              count + (source.message.attachments?.length ?? 0),
            0
          ),
        categories: [
          ...new Set(messageSummaries.flatMap((message) => message.categories)),
        ],
        customLabelIds: [
          ...new Set(
            members.flatMap(
              (message) =>
                message.labelIds?.filter(
                  (label) =>
                    ![
                      "INBOX",
                      "SENT",
                      "DRAFT",
                      "ARCHIVED",
                      "ARCHIVE",
                      "UNREAD",
                      "SPAM",
                      "TRASH",
                    ].includes(label)
                ) ?? []
            )
          ),
        ],
        id: threadId,
        isImportant: members.some(
          (message) => message.threadIsImportant === true
        ),
        isUnread: messageSummaries.some((message) => message.isUnread),
        lastMessageAt: members.at(-1)?.receivedAt,
        messageCount: members.length,
        messageIds: members.map((message) => message.id),
        messages: messageSummaries,
        participants: [
          ...new Set(
            members.flatMap((message) => (message.from ? [message.from] : []))
          ),
        ],
        snippet: members.at(-1)?.snippet,
        subject: members.find((message) => message.subject)?.subject,
      });
    }
    await publishMailUpdate({
      mailboxId: input.mailboxId,
      threadIds: appliedThreadIds,
      type: "mailbox.changed",
    });
    try {
      await recordAiMemoryEvent({
        kind: "mail_action",
        mailboxId: input.mailboxId,
        metadata: {
          action: input.important ? "mark_important" : "mark_not_important",
          senders: result.sources
            .slice(0, 3)
            .map(({ message }) => (message.from ?? "").slice(0, 180))
            .join("; "),
          subjects: result.sources
            .slice(0, 3)
            .map(({ message }) => (message.subject ?? "").slice(0, 180))
            .join("; "),
          targetCount: appliedThreadIds.length,
        },
        userId: input.actorUserId,
      });
    } catch (error) {
      reportError(error, { operation: "mail-importance:learning" });
    }
  }
  return {
    confirmedThreadSummaries: summaries,
    syncToken: result.syncToken,
    targets: result.targets.map((target) => ({
      ...target,
      summary: summaries.find(
        (summary) =>
          summary.id === target.threadId && target.status === "applied"
      ),
    })),
  };
};

export const reportPendingMailImportanceUsage = async (mailboxId?: string) => {
  const attempts = await db
    .select()
    .from(mailImportanceAttempt)
    .where(
      and(
        isNull(mailImportanceAttempt.usageReportedAt),
        isNotNull(mailImportanceAttempt.usage),
        mailboxId ? eq(mailImportanceAttempt.mailboxId, mailboxId) : undefined
      )
    )
    .orderBy(
      sql`${mailImportanceAttempt.usageReportAttemptedAt} asc nulls first`,
      asc(mailImportanceAttempt.createdAt)
    )
    .limit(50);
  for (const attempt of attempts) {
    if (!attempt.usage) {
      continue;
    }
    try {
      await db
        .update(mailImportanceAttempt)
        .set({ usageReportAttemptedAt: new Date() })
        .where(eq(mailImportanceAttempt.id, attempt.id));
      await reportAiUsage({
        ...attempt.usage,
        costUsd: attempt.usage.costUsd,
        externalId: `importance:${attempt.id}`,
        mailboxId: attempt.mailboxId,
        model: attempt.model,
        promptTokensDetails: {
          cacheWriteTokens: attempt.usage.cacheWriteTokens,
          cachedTokens: attempt.usage.cachedTokens,
        },
        usageKind: "importance",
        userId: attempt.userId,
      });
      await db
        .update(mailImportanceAttempt)
        .set({ usageReportedAt: new Date() })
        .where(eq(mailImportanceAttempt.id, attempt.id));
    } catch (error) {
      reportError(error, { operation: "mail-importance:usage" });
    }
  }
};

export const processPendingMailImportance = async (
  input: { mailboxId?: string; limit?: number } = {}
) => {
  await reportPendingMailImportanceUsage(input.mailboxId);
  const limit = Math.min(input.limit ?? 4, 20);
  const boxes = await db
    .select({ id: mailbox.id })
    .from(mailbox)
    .where(
      and(
        input.mailboxId ? eq(mailbox.id, input.mailboxId) : undefined,
        sql`(
    exists (select 1 from ${gmailCapturedMessage} c where c."mailboxId" = ${mailbox.id} and c."deletedAt" is null and not (c.snapshot->'labelIds' ?| array['SENT','DRAFT']) and not exists (select 1 from ${mailMessageImportance} i where i."mailboxId" = c."mailboxId" and i."messageId" = c."messageId"))
    or exists (select 1 from ${managedMailMessage} m where m."mailboxId" = ${mailbox.id} and m.direction = 'inbound' and not exists (select 1 from ${mailMessageImportance} i where i."mailboxId" = m."mailboxId" and i."messageId" = m.id))
  )`
      )
    )
    .limit(20);
  for (const box of boxes) {
    const gmail = await db
      .select({ source: gmailCapturedMessage })
      .from(gmailCapturedMessage)
      .leftJoin(
        mailMessageImportance,
        and(
          eq(mailMessageImportance.mailboxId, gmailCapturedMessage.mailboxId),
          eq(mailMessageImportance.messageId, gmailCapturedMessage.messageId)
        )
      )
      .where(
        and(
          eq(gmailCapturedMessage.mailboxId, box.id),
          isNull(gmailCapturedMessage.deletedAt),
          sql`not (${gmailCapturedMessage.snapshot}->'labelIds' ?| array['SENT','DRAFT'])`,
          isNull(mailMessageImportance.messageId)
        )
      )
      .limit(limit);
    for (const { source } of gmail) {
      if (
        source.snapshot &&
        !source.snapshot.labelIds.some((label) =>
          ["SENT", "DRAFT"].includes(label)
        )
      ) {
        await ensureMailImportanceWork(db, {
          mailboxId: box.id,
          message: source.snapshot,
          messageId: source.messageId,
          receivedAt: new Date(
            Number(source.snapshot.internalDate) || Date.now()
          ),
          threadId: source.snapshot.threadId,
        });
      }
    }
    const managed = await db
      .select({ source: managedMailMessage })
      .from(managedMailMessage)
      .leftJoin(
        mailMessageImportance,
        and(
          eq(mailMessageImportance.mailboxId, managedMailMessage.mailboxId),
          eq(mailMessageImportance.messageId, managedMailMessage.id)
        )
      )
      .where(
        and(
          eq(managedMailMessage.mailboxId, box.id),
          eq(managedMailMessage.direction, "inbound"),
          isNull(mailMessageImportance.messageId)
        )
      )
      .limit(limit);
    for (const { source } of managed) {
      await ensureMailImportanceWork(db, {
        mailboxId: box.id,
        message: source,
        messageId: source.id,
        receivedAt: source.sentAt,
        threadId: source.threadId,
      });
    }
  }
  for (let index = 0; index < limit; index += 1) {
    const job = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(mailMessageImportance)
        .where(
          and(
            input.mailboxId
              ? eq(mailMessageImportance.mailboxId, input.mailboxId)
              : undefined,
            inArray(mailMessageImportance.state, [
              "pending",
              "processing",
              "paused",
              "error",
            ]),
            lte(mailMessageImportance.nextAttemptAt, new Date()),
            or(
              isNull(mailMessageImportance.leaseExpiresAt),
              lte(mailMessageImportance.leaseExpiresAt, new Date())
            )
          )
        )
        .orderBy(asc(mailMessageImportance.nextAttemptAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (row === undefined) {
        return null;
      }
      const leaseId = randomUUID();
      await tx
        .update(mailMessageImportance)
        .set({
          leaseExpiresAt: new Date(Date.now() + 120_000),
          leaseId,
          state: "processing",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mailMessageImportance.mailboxId, row.mailboxId),
            eq(mailMessageImportance.messageId, row.messageId)
          )
        );
      return { ...row, leaseId };
    });
    if (!job) {
      break;
    }
    const claim = and(
      eq(mailMessageImportance.mailboxId, job.mailboxId),
      eq(mailMessageImportance.messageId, job.messageId),
      eq(mailMessageImportance.leaseId, job.leaseId),
      eq(mailMessageImportance.contentHash, job.contentHash),
      gt(mailMessageImportance.leaseExpiresAt, sql`now()`)
    );
    let usage: AiUsageReport | undefined;
    let attemptId: string | undefined;
    try {
      const [source] = await loadImportanceSources(db, job.mailboxId, [
        job.messageId,
      ]);
      if (!source?.incoming) {
        await db
          .update(mailMessageImportance)
          .set({ leaseExpiresAt: null, leaseId: null, state: "cancelled" })
          .where(claim);
        continue;
      }
      const [owner] = await db
        .select({
          organizationId: mailbox.organizationId,
          userId: organization.billingOwnerUserId,
        })
        .from(mailbox)
        .innerJoin(organization, eq(organization.id, mailbox.organizationId))
        .where(eq(mailbox.id, job.mailboxId));
      if (!owner?.userId) {
        throw new Error("Mailbox billing owner unavailable.");
      }
      const budget = await getMailAutomationAiBudgetStatus({
        organizationId: owner.organizationId,
        userId: owner.userId,
      });
      if (!budget.allowed) {
        await db
          .update(mailMessageImportance)
          .set({
            lastError: budget.reason,
            leaseExpiresAt: null,
            leaseId: null,
            nextAttemptAt: new Date(Date.now() + 300_000),
            state: "paused",
          })
          .where(claim);
        continue;
      }
      const memoryActor = await getMailboxMemoryActor({
        mailboxId: job.mailboxId,
      });
      const context =
        memoryActor === null
          ? null
          : await loadAiAgentContext({
              agent: "mail_importance",
              mailboxId: job.mailboxId,
              query: buildMailMemoryQuery(source.message),
              userId: memoryActor.userId,
            });
      attemptId = randomUUID();
      await db.insert(mailImportanceAttempt).values({
        createdAt: new Date(),
        id: attemptId,
        mailboxId: job.mailboxId,
        messageId: job.messageId,
        model: resolveBackgroundModel(),
        organizationId: owner.organizationId,
        userId: owner.userId,
      });
      const decision = await classifyMailImportance({
        context: context === null ? null : serializeAiAgentContext(context),
        message: source.message,
        onUsage: (report) => {
          usage = report;
        },
      });
      await db
        .update(mailImportanceAttempt)
        .set({ ...(usage ? { usage } : {}), completedAt: new Date() })
        .where(eq(mailImportanceAttempt.id, attemptId));
      const changed = await db.transaction(async (tx) => {
        const rows = await tx
          .update(mailMessageImportance)
          .set({
            aiImportant: decision.important,
            attemptCount: job.attemptCount + 1,
            lastError: null,
            leaseExpiresAt: null,
            leaseId: null,
            state: "completed",
            updatedAt: new Date(),
          })
          .where(claim)
          .returning({ id: mailMessageImportance.messageId });
        if (rows.length) {
          await tx
            .update(mailbox)
            .set({
              contentRevision: sql`${mailbox.contentRevision} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(mailbox.id, job.mailboxId));
        }
        return rows.length > 0;
      });
      if (changed) {
        await publishMailUpdate({
          mailboxId: job.mailboxId,
          threadIds: [job.threadId],
          type: "mailbox.changed",
        });
      }
    } catch (error) {
      reportError(error, { operation: "mail-importance:classification" });
      await db
        .update(mailMessageImportance)
        .set({
          attemptCount: job.attemptCount + 1,
          lastError: "Classification failed.",
          leaseExpiresAt: null,
          leaseId: null,
          nextAttemptAt: new Date(
            Date.now() +
              Math.min(3_600_000, 60_000 * 2 ** Math.min(job.attemptCount, 6))
          ),
          state: "error",
          updatedAt: new Date(),
        })
        .where(claim);
    } finally {
      if (attemptId) {
        await db
          .update(mailImportanceAttempt)
          .set({ ...(usage ? { usage } : {}), completedAt: new Date() })
          .where(eq(mailImportanceAttempt.id, attemptId));
      }
    }
  }
  await reportPendingMailImportanceUsage(input.mailboxId);
};

export const parseCapturedImportanceSearch = (
  query: string | undefined
): MailSearchExpression | null => {
  try {
    return parseMailSearchExpression(query ?? "");
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ORPCError("BAD_REQUEST", { message: error.message });
    }
    throw error;
  }
};

const capturedImportanceSearch = (expression: MailSearchExpression): SQL => {
  if (expression.type === "and" || expression.type === "or") {
    const left = capturedImportanceSearch(expression.left);
    const right = capturedImportanceSearch(expression.right);
    return expression.type === "and"
      ? sql`(${left}) and (${right})`
      : sql`(${left}) or (${right})`;
  }
  if (expression.type === "not") {
    return sql`not (${capturedImportanceSearch(expression.operand)})`;
  }
  if (expression.type === "text") {
    const document = sql`jsonb_to_tsvector('simple', jsonb_build_array(
      ${gmailCapturedMessage.snapshot}->>'bodyText',
      ${gmailCapturedMessage.snapshot}->>'bodyHtml',
      (select jsonb_agg(jsonb_build_array(h->>'value', regexp_replace(h->>'value', '[^[:alnum:]]+', ' ', 'g')))
        from jsonb_array_elements(${gmailCapturedMessage.snapshot}->'headers') h),
      (select jsonb_agg(jsonb_build_array(a->>'fileName', regexp_replace(a->>'fileName', '[^[:alnum:]]+', ' ', 'g')))
        from jsonb_array_elements(${gmailCapturedMessage.snapshot}->'attachments') a)
    ), '["string"]')`;
    const query = expression.phrase
      ? sql`phraseto_tsquery('simple', ${expression.value})`
      : sql`plainto_tsquery('simple', ${expression.value})`;
    return sql`${document} @@ ${query}`;
  }
  const { filter } = expression;
  const pattern = `%${filter.value.replaceAll(/[%_\\]/gu, "\\$&")}%`;
  let condition: SQL | undefined;
  if (["from", "to", "cc", "bcc", "subject"].includes(filter.type)) {
    condition = sql`exists (select 1 from jsonb_array_elements(${gmailCapturedMessage.snapshot}->'headers') h where lower(h->>'name') = ${filter.type} and h->>'value' ilike ${pattern})`;
  } else if (filter.type === "content") {
    condition = ilike(
      sql`coalesce(${gmailCapturedMessage.snapshot}->>'bodyText', '')`,
      pattern
    );
  } else if (filter.type === "filename") {
    condition = sql`exists (select 1 from jsonb_array_elements(${gmailCapturedMessage.snapshot}->'attachments') a where a->>'fileName' ilike ${pattern})`;
  } else if (filter.type === "has" && filter.value === "attachment") {
    condition = sql`jsonb_array_length(${gmailCapturedMessage.snapshot}->'attachments') > 0`;
  } else if (filter.type === "is") {
    if (filter.value === "read" || filter.value === "unread") {
      condition = sql`${gmailCapturedMessage.snapshot}->'labelIds' ? 'UNREAD'`;
      if (filter.value === "read") {
        condition = sql`not (${condition})`;
      }
    } else if (filter.value === "archived") {
      condition = sql`not (${gmailCapturedMessage.snapshot}->'labelIds' ? 'INBOX')`;
    }
  } else if (filter.type === "label") {
    condition = sql`${gmailCapturedMessage.snapshot}->'labelIds' ? ${filter.value}`;
  } else if (
    ["before", "after", "newer_than", "older_than"].includes(filter.type)
  ) {
    const date =
      filter.type === "before" || filter.type === "after"
        ? parseAbsoluteDate(filter.value)
        : parseRelativeDate(filter.value, new Date());
    if (date && !Number.isNaN(date.getTime())) {
      condition =
        filter.type === "before" || filter.type === "older_than"
          ? lt(
              sql`to_timestamp(nullif(${gmailCapturedMessage.snapshot}->>'internalDate', '')::numeric / 1000)`,
              sql`${date.toISOString()}::timestamptz`
            )
          : gte(
              sql`to_timestamp(nullif(${gmailCapturedMessage.snapshot}->>'internalDate', '')::numeric / 1000)`,
              sql`${date.toISOString()}::timestamptz`
            );
    }
  }
  if (!condition) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This search contains an invalid filter value.",
    });
  }
  return filter.negated === true ? sql`not (${condition})` : condition;
};

export const listCapturedImportantMessages = async (input: {
  mailboxId: string;
  maxResults?: number;
  pageToken?: string;
  matchingMessageIds?: string[];
  query?: string;
  searchExpression?: MailSearchExpression | null;
}): Promise<ListMessagesPageResult> => {
  const expression =
    input.searchExpression === undefined
      ? parseCapturedImportanceSearch(input.query)
      : input.searchExpression;
  const cursorSchema = z.object({
    messageId: z.string(),
    receivedAt: z.iso.datetime(),
  });
  let cursor: z.infer<typeof cursorSchema> | null = null;
  if (input.pageToken) {
    try {
      cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(input.pageToken, "base64url").toString("utf-8"))
      );
    } catch {
      throw new ORPCError("BAD_REQUEST", {
        message: "The message page token is invalid.",
      });
    }
  }
  const receivedAt =
    sql<Date>`coalesce(to_timestamp(nullif(${gmailCapturedMessage.snapshot}->>'internalDate', '')::numeric / 1000), ${gmailCapturedMessage.capturedAt})`.mapWith(
      mailMessageImportance.receivedAt
    );
  const threadId = sql<string>`${gmailCapturedMessage.snapshot}->>'threadId'`;
  const matching = db
    .selectDistinctOn([threadId], {
      messageId: gmailCapturedMessage.messageId,
      receivedAt: receivedAt.as("receivedAt"),
      threadId: threadId.as("threadId"),
    })
    .from(gmailCapturedMessage)
    .where(
      and(
        eq(gmailCapturedMessage.mailboxId, input.mailboxId),
        isNull(gmailCapturedMessage.deletedAt),
        sql`not (${gmailCapturedMessage.snapshot}->'labelIds' ?| array['SENT','DRAFT','SPAM','TRASH'])`,
        sql`exists (select 1 from ${mailMessageImportance} i inner join ${gmailCapturedMessage} c on c."mailboxId" = i."mailboxId" and c."messageId" = i."messageId" where i."mailboxId" = ${gmailCapturedMessage.mailboxId} and i."threadId" = ${threadId} and coalesce(i."manualImportant", i."aiImportant", false) and c."deletedAt" is null and not (c.snapshot->'labelIds' ?| array['SENT','DRAFT','SPAM','TRASH']))`,
        input.matchingMessageIds
          ? inArray(gmailCapturedMessage.messageId, input.matchingMessageIds)
          : undefined,
        expression ? capturedImportanceSearch(expression) : undefined
      )
    )
    .orderBy(threadId, desc(receivedAt), desc(gmailCapturedMessage.messageId))
    .as("important_threads");
  const limit = Math.min(input.maxResults ?? 15, 100);
  const rows = await db
    .select()
    .from(matching)
    .where(
      cursor
        ? or(
            lt(matching.receivedAt, sql`${cursor.receivedAt}::timestamptz`),
            and(
              eq(matching.receivedAt, sql`${cursor.receivedAt}::timestamptz`),
              lt(matching.messageId, cursor.messageId)
            )
          )
        : undefined
    )
    .orderBy(desc(matching.receivedAt), desc(matching.messageId))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const sources = page.length
    ? await loadImportanceSources(
        db,
        input.mailboxId,
        undefined,
        page.map((row) => row.threadId)
      )
    : [];
  const byId = new Map(sources.map((source) => [source.message.id, source]));
  const messages = await Promise.all(
    page.map(async (row): Promise<MessageListItem | null> => {
      const source = byId.get(row.messageId);
      if (!source) {
        return null;
      }
      const members = sources.filter(
        (item) => item.message.threadId === row.threadId
      );
      const { message } = source;
      return {
        from: message.from ?? undefined,
        id: row.messageId,
        internalDate: String(row.receivedAt.getTime()),
        isUnread: members.some(
          (member) => member.message.labelIds?.includes("UNREAD") === true
        ),
        labelIds: message.labelIds,
        senderAvatarUrls: await getSenderAvatarUrls(message.from ?? undefined, {
          headers: message.headers ?? [],
        }),
        snippet: message.snippet ?? undefined,
        subject: message.subject ?? undefined,
        threadAttachmentCount: members.reduce(
          (count, member) => count + (member.message.attachments?.length ?? 0),
          0
        ),
        threadAttachmentNames: members.flatMap(
          (member) =>
            member.message.attachments?.map(
              (attachment) => attachment.fileName
            ) ?? []
        ),
        threadId: row.threadId,
        threadIsImportant: true,
        threadLabelIds: [
          ...new Set(
            members.flatMap((member) => member.message.labelIds ?? [])
          ),
        ],
        threadMessageCount: members.length,
        to: message.to ?? undefined,
        unsubscribeKey: message.unsubscribeKey,
        unsubscribeMailto: message.unsubscribeMailto,
        unsubscribeUrl: message.unsubscribeUrl,
      };
    })
  );
  const last = page.at(-1);
  const [selected] = await db
    .select({ revision: mailbox.contentRevision })
    .from(mailbox)
    .where(eq(mailbox.id, input.mailboxId));
  return {
    historyId: `app:${selected.revision}`,
    messages: await hydrateMailImportance(
      input.mailboxId,
      messages.filter((message) => message !== null)
    ),
    nextPageToken:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({
              messageId: last.messageId,
              receivedAt: last.receivedAt.toISOString(),
            })
          ).toString("base64url")
        : undefined,
  };
};
