import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  managedMailMessage,
  managedMailRule,
  managedMailRuleApplication,
  managedMailRuleBackfill,
} from "@quieter/database/schema";
import {
  getManagedMailboxRuleActions,
  managedMailboxRuleDefinitionSchema,
  type ManagedMailboxRuleAction,
  type ManagedMailboxRuleDefinition,
} from "@quieter/mail/mailbox-organization";
import { and, asc, countDistinct, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getAuthorizedManagedMailbox } from "../../mailbox/access";
import { assertManagedLabelsBelongToMailbox } from "../labels/repository";
import { normalizeManagedOrganizationName } from "../organization/normalize-name";
import { createManagedSearchCondition } from "../search/compiler";
import { assertManagedRuleSearch } from "../search/normalization";
import { applyManagedRulesToMessage } from "./evaluator";

const assertRuleActions = (
  definition: {
    actions?: unknown;
    labelIds: readonly string[];
  },
  options: { allowEmpty?: boolean } = {},
) => {
  const actions = getManagedMailboxRuleActions(definition, options);
  if (actions.length === 0 && !options.allowEmpty) {
    throw new ORPCError("BAD_REQUEST", { message: "Add at least one rule action." });
  }

  const seenKinds = new Set<string>();
  for (const [index, action] of actions.entries()) {
    if (
      action.kind === "set-labels" &&
      action.addIds.length === 0 &&
      action.removeIds.length === 0
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "A label action must change at least one label.",
      });
    }
    if (action.kind === "stop-processing" && index !== actions.length - 1) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Stop processing must be the last action.",
      });
    }
    if (action.kind === "move" || action.kind === "set-read") {
      if (seenKinds.has(action.kind)) {
        throw new ORPCError("BAD_REQUEST", {
          message: `A rule can contain only one ${action.kind === "move" ? "mailbox move" : "read-state"} action.`,
        });
      }
      seenKinds.add(action.kind);
    }
  }
  return actions;
};

const getRuleLabelIds = (actions: readonly ManagedMailboxRuleAction[], legacy: string[]) =>
  Array.from(
    new Set([
      ...legacy,
      ...actions.flatMap((action) => (action.kind === "set-labels" ? action.addIds : [])),
    ]),
  );

const assertRuleDefinition = async (
  mailboxId: string,
  mailboxEmail: string,
  definition: ManagedMailboxRuleDefinition,
) => {
  const parsed = managedMailboxRuleDefinitionSchema.parse(definition);
  const actions = assertRuleActions(parsed);
  const forwardedRecipients = actions.flatMap((action) =>
    action.kind === "forward" ? action.recipients : [],
  );
  if (
    forwardedRecipients.some((recipient) => recipient.toLowerCase() === mailboxEmail.toLowerCase())
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "A rule cannot forward messages back to the same mailbox.",
    });
  }
  const labelIds = getRuleLabelIds(actions, parsed.labelIds);
  await assertManagedLabelsBelongToMailbox(mailboxId, labelIds);
  return {
    ...parsed,
    actions,
    conditionGroups: parsed.conditionGroups?.map((group) => ({
      ...group,
      search: assertManagedRuleSearch(group.search),
    })),
    labelIds,
    search: assertManagedRuleSearch(parsed.search),
  };
};

const parseStoredActions = (value: unknown, labelIds: string[]) => {
  return getManagedMailboxRuleActions({ actions: value, labelIds }, { allowEmpty: true });
};

const toRuleResponse = <T extends { actions: unknown; labelIds: string[] }>(record: T) => ({
  ...record,
  actions: parseStoredActions(record.actions, record.labelIds),
});

export const listManagedRules = async (input: { mailboxId: string; userId: string }) => {
  await getAuthorizedManagedMailbox(input);
  const records = await db
    .select()
    .from(managedMailRule)
    .where(eq(managedMailRule.mailboxId, input.mailboxId))
    .orderBy(asc(managedMailRule.priority), asc(managedMailRule.name));
  return records.map(toRuleResponse);
};

export const createManagedRule = async (input: {
  definition: ManagedMailboxRuleDefinition;
  mailboxId: string;
  userId: string;
}) => {
  const selectedMailbox = await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  const definition = await assertRuleDefinition(
    input.mailboxId,
    selectedMailbox.emailAddress,
    input.definition,
  );
  const now = new Date();
  const [record] = await db
    .insert(managedMailRule)
    .values({
      createdAt: now,
      createdByUserId: input.userId,
      actions: definition.actions,
      enabled: definition.enabled,
      conditionGroups: definition.conditionGroups,
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
  return record ? toRuleResponse(record) : record;
};

export const updateManagedRule = async (input: {
  definition: ManagedMailboxRuleDefinition;
  mailboxId: string;
  ruleId: string;
  userId: string;
}) => {
  const selectedMailbox = await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  const definition = await assertRuleDefinition(
    input.mailboxId,
    selectedMailbox.emailAddress,
    input.definition,
  );
  const [existing] = await db
    .select({
      actions: managedMailRule.actions,
      conditionGroups: managedMailRule.conditionGroups,
      labelIds: managedMailRule.labelIds,
      matchMode: managedMailRule.matchMode,
      search: managedMailRule.search,
    })
    .from(managedMailRule)
    .where(
      and(eq(managedMailRule.id, input.ruleId), eq(managedMailRule.mailboxId, input.mailboxId)),
    )
    .limit(1);
  if (!existing) throw new ORPCError("NOT_FOUND", { message: "Rule not found." });
  const matchingOrActionConfigurationChanged =
    existing.matchMode !== definition.matchMode ||
    JSON.stringify(existing.search) !== JSON.stringify(definition.search) ||
    JSON.stringify(existing.conditionGroups ?? []) !==
      JSON.stringify(definition.conditionGroups ?? []) ||
    JSON.stringify(existing.labelIds) !== JSON.stringify(definition.labelIds) ||
    JSON.stringify(
      getManagedMailboxRuleActions({ actions: existing.actions, labelIds: existing.labelIds }),
    ) !== JSON.stringify(definition.actions);
  const [record] = await db
    .update(managedMailRule)
    .set({
      actions: definition.actions,
      enabled: definition.enabled,
      conditionGroups: definition.conditionGroups,
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
  if (matchingOrActionConfigurationChanged) {
    await db
      .delete(managedMailRuleApplication)
      .where(eq(managedMailRuleApplication.ruleId, input.ruleId));
  }
  return toRuleResponse(record);
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
  const selectedMailbox = await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  const definition = await assertRuleDefinition(
    input.mailboxId,
    selectedMailbox.emailAddress,
    input.definition,
  );
  const now = new Date();
  const searchCondition = createManagedSearchCondition(
    input.mailboxId,
    definition.search,
    now,
    definition.matchMode,
  );
  const conditionGroupConditions =
    definition.conditionGroups?.map((group) =>
      createManagedSearchCondition(input.mailboxId, group.search, now, group.matchMode),
    ) ?? [];
  const where = and(
    eq(managedMailMessage.mailboxId, input.mailboxId),
    eq(managedMailMessage.direction, "inbound"),
    searchCondition,
    ...conditionGroupConditions,
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
  return {
    count: Number(countRows[0]?.count ?? 0),
    samples,
  };
};

const processManagedBackfillBatch = async (backfillId: string) => {
  const [backfill] = await db
    .select()
    .from(managedMailRuleBackfill)
    .where(eq(managedMailRuleBackfill.id, backfillId))
    .limit(1);
  if (!backfill || !["pending", "running"].includes(backfill.status)) return backfill;
  const [rule] = await db
    .select({ id: managedMailRule.id })
    .from(managedMailRule)
    .where(eq(managedMailRule.id, backfill.ruleId))
    .limit(1);
  if (!rule) return backfill;

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
      const result = await applyManagedRulesToMessage({
        mailboxId: backfill.mailboxId,
        messageId: message.id,
        ruleId: backfill.ruleId,
      });
      if (result?.matched) {
        matchedCount += 1;
        if (!result.error) updatedCount += 1;
      }
      if (result?.error) errorCount += 1;
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
