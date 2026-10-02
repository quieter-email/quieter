import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import type { DatabaseExecutor } from "@quieter/database/client";
import {
  managedMailMessage,
  managedMailRule,
  managedMailRuleBackfill,
} from "@quieter/database/schema";
import {
  getManagedMailboxRuleActions,
  managedMailboxRuleDefinitionSchema,
} from "@quieter/mail/mailbox-organization";
import type {
  ManagedMailboxRuleAction,
  ManagedMailboxRuleDefinition,
} from "@quieter/mail/mailbox-organization";
import { and, asc, countDistinct, desc, eq, inArray } from "drizzle-orm";

import { getAuthorizedManagedMailbox } from "../../mailbox/access";
import { resolveManagedSearchLabels } from "../labels/references";
import { assertManagedLabelsBelongToMailbox } from "../labels/repository";
import { throwMailboxOrganizationNameConflict } from "../organization/name-conflict";
import { normalizeManagedOrganizationName } from "../organization/normalize-name";
import { createManagedSearchCondition } from "../search/compiler";
import { assertManagedRuleSearch } from "../search/normalization";
import { managedRuleSnapshotSchema, snapshotManagedRule } from "./snapshot";

const assertRuleActions = (definition: {
  actions?: unknown;
  labelIds: readonly string[];
}) => {
  const actions = getManagedMailboxRuleActions(definition);
  if (actions.length === 0) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Add at least one rule action.",
    });
  }

  const seenKinds = new Set<string>();
  for (const [index, action] of actions.entries()) {
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

const getRuleLabelIds = (
  actions: readonly ManagedMailboxRuleAction[],
  legacy: string[]
) => [
  ...new Set([
    ...legacy,
    ...actions.flatMap((action) =>
      action.kind === "set-labels" ? action.addIds : []
    ),
  ]),
];

const assertRuleDefinition = async (
  mailboxId: string,
  mailboxEmail: string,
  definition: ManagedMailboxRuleDefinition,
  database: DatabaseExecutor = db
) => {
  const parsed = managedMailboxRuleDefinitionSchema.parse(definition);
  for (const search of [
    parsed.search,
    ...(parsed.conditionGroups ?? []).map((group) => group.search),
  ]) {
    createManagedSearchCondition(mailboxId, search, { fullText: false });
  }
  const actions = assertRuleActions(parsed);
  const forwardedRecipients = actions.flatMap((action) =>
    action.kind === "forward" ? action.recipients : []
  );
  if (
    forwardedRecipients.some(
      (recipient) => recipient.toLowerCase() === mailboxEmail.toLowerCase()
    )
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "A rule cannot forward messages back to the same mailbox.",
    });
  }
  const labelIds = getRuleLabelIds(actions, parsed.labelIds);
  await assertManagedLabelsBelongToMailbox(
    mailboxId,
    [
      ...labelIds,
      ...actions.flatMap((action) =>
        action.kind === "set-labels" ? action.removeIds : []
      ),
    ],
    database
  );
  return {
    ...parsed,
    actions,
    conditionGroups: await Promise.all(
      (parsed.conditionGroups ?? []).map(async (group) => ({
        ...group,
        search: await resolveManagedSearchLabels(
          database,
          mailboxId,
          assertManagedRuleSearch(group.search)
        ),
      }))
    ),
    labelIds,
    search: await resolveManagedSearchLabels(
      database,
      mailboxId,
      assertManagedRuleSearch(parsed.search)
    ),
  };
};

const toRuleResponse = <T extends { actions: unknown; labelIds: string[] }>(
  record: T
) => ({
  ...record,
  actions: getManagedMailboxRuleActions({
    actions: record.actions,
    labelIds: record.labelIds,
  }),
});

export const listManagedRules = async (input: {
  mailboxId: string;
  userId: string;
}) => {
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
  return await db.transaction(async (tx) => {
    const definition = await assertRuleDefinition(
      input.mailboxId,
      selectedMailbox.emailAddress,
      input.definition,
      tx
    );
    const now = new Date();
    const [record] = await tx
      .insert(managedMailRule)
      .values({
        actions: definition.actions,
        conditionGroups: definition.conditionGroups,
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
      .returning()
      .catch(throwMailboxOrganizationNameConflict);
    if (record === undefined) {
      return record;
    }
    return toRuleResponse(record);
  });
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
  return await db.transaction(async (tx) => {
    const definition = await assertRuleDefinition(
      input.mailboxId,
      selectedMailbox.emailAddress,
      input.definition,
      tx
    );
    const [record] = await tx
      .update(managedMailRule)
      .set({
        actions: definition.actions,
        conditionGroups: definition.conditionGroups,
        disabledReason: null,
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
        and(
          eq(managedMailRule.id, input.ruleId),
          eq(managedMailRule.mailboxId, input.mailboxId)
        )
      )
      .returning()
      .catch(throwMailboxOrganizationNameConflict);
    if (record === undefined) {
      throw new ORPCError("NOT_FOUND", { message: "Rule not found." });
    }
    return toRuleResponse(record);
  });
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
      and(
        eq(managedMailRule.id, input.ruleId),
        eq(managedMailRule.mailboxId, input.mailboxId)
      )
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
              inArray(managedMailRule.id, input.ruleIds)
            )
          )
      : [];
  if (rules.length !== new Set(input.ruleIds).size) {
    throw new ORPCError("BAD_REQUEST", {
      message: "One or more rules are unavailable.",
    });
  }
  await Promise.all(
    input.ruleIds.map((ruleId, priority) =>
      db
        .update(managedMailRule)
        .set({ priority, updatedAt: new Date(), updatedByUserId: input.userId })
        .where(eq(managedMailRule.id, ruleId))
    )
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
    input.definition
  );
  const now = new Date();
  const searchCondition = createManagedSearchCondition(
    input.mailboxId,
    definition.search,
    { fullText: false, matchMode: definition.matchMode, now }
  );
  const conditionGroupConditions =
    definition.conditionGroups?.map((group) =>
      createManagedSearchCondition(input.mailboxId, group.search, {
        fullText: false,
        matchMode: group.matchMode,
        now,
      })
    ) ?? [];
  const where = and(
    eq(managedMailMessage.mailboxId, input.mailboxId),
    eq(managedMailMessage.direction, "inbound"),
    searchCondition,
    ...conditionGroupConditions
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
    count: countRows[0]?.count ?? 0,
    samples,
  };
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
  return await db.transaction(async (tx) => {
    const [rule] = await tx
      .select()
      .from(managedMailRule)
      .where(
        and(
          eq(managedMailRule.id, input.ruleId),
          eq(managedMailRule.mailboxId, input.mailboxId)
        )
      )
      .for("update");
    if (rule === undefined) {
      throw new ORPCError("NOT_FOUND", { message: "Rule not found." });
    }
    if (!rule.enabled) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Enable this rule before applying it to existing messages.",
      });
    }
    const jobs = await tx
      .select()
      .from(managedMailRuleBackfill)
      .where(
        and(
          eq(managedMailRuleBackfill.ruleId, input.ruleId),
          inArray(managedMailRuleBackfill.status, [
            "pending",
            "running",
            "failed",
          ])
        )
      )
      .orderBy(desc(managedMailRuleBackfill.createdAt));
    if (jobs.some((job) => job.status !== "failed")) {
      throw new ORPCError("CONFLICT", {
        message: "This rule already has an active backfill.",
      });
    }
    const definition = snapshotManagedRule(rule);
    const now = new Date();
    const retry = jobs.find(
      (job) =>
        managedRuleSnapshotSchema.safeParse(job.definition).data?.revision ===
        definition.revision
    );
    if (retry !== undefined) {
      const [backfill] = await tx
        .update(managedMailRuleBackfill)
        .set({
          completedAt: null,
          lastError: null,
          leaseId: null,
          leasedUntil: null,
          status: "pending",
          updatedAt: now,
        })
        .where(eq(managedMailRuleBackfill.id, retry.id))
        .returning();
      return backfill;
    }
    const [backfill] = await tx
      .insert(managedMailRuleBackfill)
      .values({
        createdAt: now,
        definition,
        id: randomUUID(),
        mailboxId: input.mailboxId,
        ruleId: input.ruleId,
        status: "pending",
        updatedAt: now,
      })
      .returning();
    return backfill;
  });
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
  const [updated] = await db
    .select()
    .from(managedMailRuleBackfill)
    .where(
      and(
        eq(managedMailRuleBackfill.id, input.backfillId),
        eq(managedMailRuleBackfill.mailboxId, input.mailboxId)
      )
    );
  if (updated === undefined) {
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
    .set({
      cancelledAt: new Date(),
      status: "cancelled",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(managedMailRuleBackfill.id, input.backfillId),
        eq(managedMailRuleBackfill.mailboxId, input.mailboxId),
        inArray(managedMailRuleBackfill.status, ["pending", "running"])
      )
    )
    .returning();
  if (updated === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Active backfill not found." });
  }
  return updated;
};
