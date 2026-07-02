import type { ChatMiddleware } from "@tanstack/ai";
import {
  editUserAiContext,
  USER_AI_CONTEXT_MARKDOWN_MAX_LENGTH,
  USER_AI_CONTEXT_MODEL,
  type UserAiContextEditorEvent,
} from "@quieter/ai/user-ai-context";
import { reportAiUsage } from "@quieter/billing";
import { getBillingCreditUsage } from "@quieter/billing/credits";
import { hasUserBillingFeature } from "@quieter/billing/entitlements";
import { db } from "@quieter/database/client";
import {
  mailbox,
  userAiContext,
  userAiContextEvent,
  type UserAiContextEventKind,
} from "@quieter/database/schema";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const USER_AI_CONTEXT_EVENT_LIMIT = 20;
const USER_AI_CONTEXT_METADATA_STRING_LIMIT = 600;

export type UserAiContextEventMetadata = Record<string, string | number | boolean | null>;

const sanitizeMetadata = (metadata: UserAiContextEventMetadata): UserAiContextEventMetadata => {
  const sanitized: UserAiContextEventMetadata = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      sanitized[key] = trimmed ? trimmed.slice(0, USER_AI_CONTEXT_METADATA_STRING_LIMIT) : null;
      continue;
    }

    if (typeof value === "number") {
      if (Number.isFinite(value)) sanitized[key] = value;
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
};

const getMailboxOrganizationId = async (mailboxId: string) => {
  const [record] = await db
    .select({ organizationId: mailbox.organizationId })
    .from(mailbox)
    .where(eq(mailbox.id, mailboxId))
    .limit(1);

  return record?.organizationId ?? null;
};

export const loadUserAiContextPrompt = async ({ userId }: { userId: string }) => {
  const [record] = await db
    .select({ markdown: userAiContext.markdown })
    .from(userAiContext)
    .where(eq(userAiContext.userId, userId))
    .limit(1);

  const markdown = record?.markdown.trim();
  if (!markdown || markdown.length > USER_AI_CONTEXT_MARKDOWN_MAX_LENGTH) return null;

  return markdown;
};

export const recordUserAiContextEvent = async (input: {
  kind: UserAiContextEventKind;
  mailboxId: string;
  metadata: UserAiContextEventMetadata;
  userId: string;
}) => {
  const organizationId = await getMailboxOrganizationId(input.mailboxId);
  if (!organizationId) return null;

  const now = new Date();
  const [event] = await db
    .insert(userAiContextEvent)
    .values({
      createdAt: now,
      id: randomUUID(),
      kind: input.kind,
      mailboxId: input.mailboxId,
      metadata: sanitizeMetadata(input.metadata),
      organizationId,
      updatedAt: now,
      userId: input.userId,
    })
    .returning({ id: userAiContextEvent.id });

  return event ?? null;
};

const canRefreshUserAiContext = async (input: { organizationId: string; userId: string }) => {
  const entitlement = await hasUserBillingFeature({
    feature: "aiChat",
    organizationId: input.organizationId,
    userId: input.userId,
  });

  if (!entitlement.hasAccess) return false;
  if (entitlement.hasUnlimitedAccess || !entitlement.account) return true;

  const usage = await getBillingCreditUsage(entitlement.account);
  return usage.costMicroCents < usage.creditAmountMicroCents;
};

export const refreshUserAiContext = async (input: {
  mailboxId: string;
  triggerEventId?: string | null;
  userId: string;
}) => {
  const organizationId = await getMailboxOrganizationId(input.mailboxId);
  if (!organizationId) return { status: "skipped" as const };

  const events = await db
    .select({
      id: userAiContextEvent.id,
      kind: userAiContextEvent.kind,
      metadata: userAiContextEvent.metadata,
    })
    .from(userAiContextEvent)
    .where(
      and(
        eq(userAiContextEvent.userId, input.userId),
        eq(userAiContextEvent.organizationId, organizationId),
        isNull(userAiContextEvent.mergedAt),
        isNull(userAiContextEvent.skippedAt),
      ),
    )
    .orderBy(asc(userAiContextEvent.createdAt))
    .limit(USER_AI_CONTEXT_EVENT_LIMIT);
  if (events.length === 0) return { status: "skipped" as const };

  const eventIds = events.map((event) => event.id);

  if (!(await canRefreshUserAiContext({ organizationId, userId: input.userId }))) {
    await db
      .update(userAiContextEvent)
      .set({ lastError: "AI memory refresh requires available credits.", updatedAt: new Date() })
      .where(inArray(userAiContextEvent.id, eventIds));
    return { status: "ineligible" as const };
  }

  const [current] = await db
    .select({ markdown: userAiContext.markdown, revision: userAiContext.revision })
    .from(userAiContext)
    .where(eq(userAiContext.userId, input.userId))
    .limit(1);

  const nextRevision = (current?.revision ?? 0) + 1;
  let promptTokens = 0;
  let completionTokens = 0;
  const usageMiddleware: ChatMiddleware = {
    name: "user-ai-context-memory-usage",
    onUsage: (_context, usage) => {
      promptTokens += usage.promptTokens;
      completionTokens += usage.completionTokens;
    },
  };

  try {
    const result = await editUserAiContext({
      currentMarkdown: current?.markdown ?? null,
      events: events.map(
        (event): UserAiContextEditorEvent => ({
          id: event.id,
          kind: event.kind,
          metadata: event.metadata,
        }),
      ),
      middleware: [usageMiddleware],
    });
    const now = new Date();

    await reportAiUsage({
      completionTokens,
      externalId: `ai-memory:${input.triggerEventId ?? eventIds.at(-1)}:${nextRevision}`,
      mailboxId: input.mailboxId,
      model: USER_AI_CONTEXT_MODEL,
      promptTokens,
      usageKind: "aiMemory",
      userId: input.userId,
    });

    await db
      .insert(userAiContext)
      .values({
        createdAt: now,
        id: randomUUID(),
        lastEditedAt: now,
        markdown: result.markdown,
        revision: nextRevision,
        updatedAt: now,
        userId: input.userId,
      })
      .onConflictDoUpdate({
        set: {
          lastEditedAt: now,
          markdown: result.markdown,
          revision: sql`${userAiContext.revision} + 1`,
          updatedAt: now,
        },
        target: userAiContext.userId,
      });

    await db
      .update(userAiContextEvent)
      .set({ lastError: null, mergedAt: now, updatedAt: now })
      .where(inArray(userAiContextEvent.id, eventIds));

    return { status: "refreshed" as const };
  } catch (error) {
    await db
      .update(userAiContextEvent)
      .set({
        lastError: error instanceof Error ? error.message.slice(0, 2_000) : "Unknown error.",
        updatedAt: new Date(),
      })
      .where(inArray(userAiContextEvent.id, eventIds));

    return { status: "failed" as const };
  }
};

export const recordAndRefreshUserAiContext = async (input: {
  kind: UserAiContextEventKind;
  mailboxId: string;
  metadata: UserAiContextEventMetadata;
  userId: string;
}) => {
  const event = await recordUserAiContextEvent(input);
  if (!event) return { status: "skipped" as const };

  return await refreshUserAiContext({
    mailboxId: input.mailboxId,
    triggerEventId: event.id,
    userId: input.userId,
  });
};
