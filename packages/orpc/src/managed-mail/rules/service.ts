import { ORPCError } from "@orpc/server";
import {
  db,
  managedMailAttachment,
  managedMailMessage,
  managedMailRule,
  managedMailRuleBackfill,
} from "@quieter/database";
import {
  managedMailboxRuleDefinitionSchema,
  structuredMailSearchSchema,
  type ManagedMailboxRuleDefinition,
} from "@quieter/mail";
import { and, asc, countDistinct, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getAuthorizedManagedMailbox } from "../../mailbox/access";
import {
  assertManagedLabelsBelongToMailbox,
  updateManagedMessageLabelAssignments,
} from "../labels/repository";
import { normalizeManagedOrganizationName } from "../organization/normalize-name";
import { createManagedSearchCondition } from "../search/compiler";
import { matchesManagedMailRule } from "../search/evaluator";
import { assertManagedRuleSearch } from "../search/normalization";

const assertRuleLabels = async (mailboxId: string, definition: ManagedMailboxRuleDefinition) => {
  const parsed = managedMailboxRuleDefinitionSchema.parse(definition);
  await assertManagedLabelsBelongToMailbox(mailboxId, parsed.labelIds);
  return { ...parsed, search: assertManagedRuleSearch(parsed.search) };
};

export const listManagedRules = async (input: { mailboxId: string; userId: string }) => {
  await getAuthorizedManagedMailbox(input);
  return await db
    .select()
    .from(managedMailRule)
    .where(eq(managedMailRule.mailboxId, input.mailboxId))
    .orderBy(asc(managedMailRule.priority), asc(managedMailRule.name));
};

export const createManagedRule = async (input: {
  definition: ManagedMailboxRuleDefinition;
  mailboxId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  const definition = await assertRuleLabels(input.mailboxId, input.definition);
  const now = new Date();
  const [record] = await db
    .insert(managedMailRule)
    .values({
      createdAt: now,
      createdByUserId: input.userId,
      enabled: definition.enabled,
      id: randomUUID(),
      labelIds: definition.labelIds,
      mailboxId: input.mailboxId,
      matchMode: definition.matchMode,
      name: definition.name,
      normalizedName: normalizeManagedOrganizationName(definition.name),
      search: definition.search,
      updatedAt: now,
      updatedByUserId: input.userId,
    })
    .returning();
  return record;
};

export const updateManagedRule = async (input: {
  definition: ManagedMailboxRuleDefinition;
  mailboxId: string;
  ruleId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  const definition = await assertRuleLabels(input.mailboxId, input.definition);
  const [record] = await db
    .update(managedMailRule)
    .set({
      enabled: definition.enabled,
      labelIds: definition.labelIds,
      matchMode: definition.matchMode,
      name: definition.name,
      normalizedName: normalizeManagedOrganizationName(definition.name),
      search: definition.search,
      updatedAt: new Date(),
      updatedByUserId: input.userId,
    })
    .where(
      and(eq(managedMailRule.id, input.ruleId), eq(managedMailRule.mailboxId, input.mailboxId)),
    )
    .returning();
  if (!record) throw new ORPCError("NOT_FOUND", { message: "Rule not found." });
  return record;
};

export const deleteManagedRule = async (input: {
  mailboxId: string;
  ruleId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  await db
    .delete(managedMailRule)
    .where(
      and(eq(managedMailRule.id, input.ruleId), eq(managedMailRule.mailboxId, input.mailboxId)),
    );
  return { id: input.ruleId };
};

export const reorderManagedRules = async (input: {
  mailboxId: string;
  ruleIds: string[];
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  const rules =
    input.ruleIds.length > 0
      ? await db
          .select({ id: managedMailRule.id })
          .from(managedMailRule)
          .where(
            and(
              eq(managedMailRule.mailboxId, input.mailboxId),
              inArray(managedMailRule.id, input.ruleIds),
            ),
          )
      : [];
  if (rules.length !== new Set(input.ruleIds).size) {
    throw new ORPCError("BAD_REQUEST", { message: "One or more rules are unavailable." });
  }
  await Promise.all(
    input.ruleIds.map((ruleId, priority) =>
      db
        .update(managedMailRule)
        .set({ priority, updatedAt: new Date(), updatedByUserId: input.userId })
        .where(eq(managedMailRule.id, ruleId)),
    ),
  );
  return { ruleIds: input.ruleIds };
};

export const previewManagedRule = async (input: {
  definition: ManagedMailboxRuleDefinition;
  mailboxId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  const definition = await assertRuleLabels(input.mailboxId, input.definition);
  const searchCondition = createManagedSearchCondition(
    input.mailboxId,
    definition.search,
    new Date(),
    definition.matchMode,
  );
  const where = and(
    eq(managedMailMessage.mailboxId, input.mailboxId),
    eq(managedMailMessage.direction, "inbound"),
    searchCondition,
  );
  const [countRows, samples] = await Promise.all([
    db
      .select({ count: countDistinct(managedMailMessage.threadId) })
      .from(managedMailMessage)
      .where(where),
    db
      .select({
        date: managedMailMessage.sentAt,
        from: managedMailMessage.from,
        id: managedMailMessage.id,
        subject: managedMailMessage.subject,
        threadId: managedMailMessage.threadId,
      })
      .from(managedMailMessage)
      .where(where)
      .orderBy(desc(managedMailMessage.sentAt))
      .limit(5),
  ]);
  return { count: Number(countRows[0]?.count ?? 0), samples };
};

const processManagedBackfillBatch = async (backfillId: string) => {
  const [backfill] = await db
    .select()
    .from(managedMailRuleBackfill)
    .where(eq(managedMailRuleBackfill.id, backfillId))
    .limit(1);
  if (!backfill || !["pending", "running"].includes(backfill.status)) return backfill;
  const [rule] = await db
    .select()
    .from(managedMailRule)
    .where(eq(managedMailRule.id, backfill.ruleId))
    .limit(1);
  if (!rule) return backfill;

  const search = structuredMailSearchSchema.parse(rule.search);
  const cursorCondition = backfill.cursor
    ? sql`${managedMailMessage.id} > ${backfill.cursor}`
    : undefined;
  const records = await db
    .select()
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, backfill.mailboxId),
        eq(managedMailMessage.direction, "inbound"),
        cursorCondition,
      ),
    )
    .orderBy(asc(managedMailMessage.id))
    .limit(100);

  let matchedCount = 0;
  let updatedCount = 0;
  let errorCount = 0;
  for (const message of records) {
    try {
      const attachments = await db
        .select({
          fileName: managedMailAttachment.fileName,
          normalizedFileName: managedMailAttachment.normalizedFileName,
        })
        .from(managedMailAttachment)
        .where(eq(managedMailAttachment.messageId, message.id));
      if (matchesManagedMailRule({ attachments, matchMode: rule.matchMode, message, search })) {
        matchedCount += 1;
        await updateManagedMessageLabelAssignments({
          addLabelIds: rule.labelIds,
          mailboxId: backfill.mailboxId,
          messageIds: [message.id],
          ruleId: rule.id,
          source: "backfill",
        });
        updatedCount += 1;
      }
    } catch {
      errorCount += 1;
    }
  }

  const complete = records.length < 100;
  const [updated] = await db
    .update(managedMailRuleBackfill)
    .set({
      completedAt: complete ? new Date() : null,
      cursor: records.at(-1)?.id ?? backfill.cursor,
      errorCount: backfill.errorCount + errorCount,
      matchedCount: backfill.matchedCount + matchedCount,
      processedCount: backfill.processedCount + records.length,
      startedAt: backfill.startedAt ?? new Date(),
      status: complete ? "completed" : "running",
      updatedAt: new Date(),
      updatedCount: backfill.updatedCount + updatedCount,
    })
    .where(eq(managedMailRuleBackfill.id, backfill.id))
    .returning();
  return updated;
};

export const startManagedRuleBackfill = async (input: {
  mailboxId: string;
  ruleId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  const [rule] = await db
    .select({ id: managedMailRule.id })
    .from(managedMailRule)
    .where(
      and(eq(managedMailRule.id, input.ruleId), eq(managedMailRule.mailboxId, input.mailboxId)),
    )
    .limit(1);
  if (!rule) throw new ORPCError("NOT_FOUND", { message: "Rule not found." });
  const [active] = await db
    .select({ id: managedMailRuleBackfill.id })
    .from(managedMailRuleBackfill)
    .where(
      and(
        eq(managedMailRuleBackfill.ruleId, input.ruleId),
        inArray(managedMailRuleBackfill.status, ["pending", "running"]),
      ),
    )
    .limit(1);
  if (active) {
    throw new ORPCError("CONFLICT", { message: "This rule already has an active backfill." });
  }
  const now = new Date();
  const [backfill] = await db
    .insert(managedMailRuleBackfill)
    .values({
      createdAt: now,
      id: randomUUID(),
      mailboxId: input.mailboxId,
      ruleId: input.ruleId,
      startedAt: now,
      status: "running",
      updatedAt: now,
    })
    .returning();
  return await processManagedBackfillBatch(backfill.id);
};

export const getManagedRuleBackfill = async (input: {
  backfillId: string;
  mailboxId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  const updated = await processManagedBackfillBatch(input.backfillId);
  if (!updated || updated.mailboxId !== input.mailboxId) {
    throw new ORPCError("NOT_FOUND", { message: "Backfill not found." });
  }
  return updated;
};

export const cancelManagedRuleBackfill = async (input: {
  backfillId: string;
  mailboxId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  const [updated] = await db
    .update(managedMailRuleBackfill)
    .set({ cancelledAt: new Date(), status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(managedMailRuleBackfill.id, input.backfillId),
        eq(managedMailRuleBackfill.mailboxId, input.mailboxId),
        inArray(managedMailRuleBackfill.status, ["pending", "running"]),
      ),
    )
    .returning();
  if (!updated) throw new ORPCError("NOT_FOUND", { message: "Active backfill not found." });
  return updated;
};
