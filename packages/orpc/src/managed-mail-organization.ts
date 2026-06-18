import { ORPCError } from "@orpc/server";
import {
  db,
  managedMailAttachment,
  managedMailLabel,
  managedMailMessage,
  managedMailMessageLabel,
  managedMailRule,
  managedMailRuleApplication,
  managedMailRuleBackfill,
  managedMailSavedView,
} from "@quieter/database";
import {
  mailboxLabelColorSchema,
  mailboxSavedViewDefinitionSchema,
  managedMailboxRuleDefinitionSchema,
  structuredMailSearchSchema,
  type MailboxLabel,
  type MailboxSavedViewDefinition,
  type ManagedMailboxRuleDefinition,
} from "@quieter/mail";
import { and, asc, countDistinct, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getAuthorizedManagedMailbox } from "./mailbox";
import {
  assertManagedRuleSearch,
  createManagedSearchCondition,
  matchesManagedMailRule,
} from "./managed-mail-search";

const normalizeName = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase();

const toMailboxLabel = (record: typeof managedMailLabel.$inferSelect): MailboxLabel => ({
  color: mailboxLabelColorSchema.parse(record.color),
  description: record.description,
  id: record.id,
  inclusionCriteria: null,
  name: record.name,
  position: record.position,
  provider: "managed",
  type: "user",
  visible: record.visible,
});

const assertLabelsBelongToMailbox = async (mailboxId: string, labelIds: readonly string[]) => {
  const uniqueLabelIds = Array.from(new Set(labelIds));
  if (uniqueLabelIds.length === 0) return [];

  const labels = await db
    .select()
    .from(managedMailLabel)
    .where(
      and(eq(managedMailLabel.mailboxId, mailboxId), inArray(managedMailLabel.id, uniqueLabelIds)),
    );
  if (labels.length !== uniqueLabelIds.length) {
    throw new ORPCError("BAD_REQUEST", { message: "One or more labels are unavailable." });
  }
  return labels;
};

export const listManagedLabels = async (input: { mailboxId: string; userId: string }) => {
  await getAuthorizedManagedMailbox(input);
  const labels = await db
    .select()
    .from(managedMailLabel)
    .where(eq(managedMailLabel.mailboxId, input.mailboxId))
    .orderBy(asc(managedMailLabel.position), asc(managedMailLabel.name));
  return labels.map(toMailboxLabel);
};

export const listManagedLabelCounts = async (input: { mailboxId: string; userId: string }) => {
  await getAuthorizedManagedMailbox(input);
  return await db
    .select({
      count: countDistinct(managedMailMessage.threadId),
      labelId: managedMailMessageLabel.labelId,
    })
    .from(managedMailMessageLabel)
    .innerJoin(managedMailMessage, eq(managedMailMessage.id, managedMailMessageLabel.messageId))
    .where(eq(managedMailMessageLabel.mailboxId, input.mailboxId))
    .groupBy(managedMailMessageLabel.labelId);
};

export const createManagedLabel = async (input: {
  color: string;
  description?: string | null;
  mailboxId: string;
  name: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  const name = input.name.replace(/\s+/g, " ").trim();
  const now = new Date();
  const [record] = await db
    .insert(managedMailLabel)
    .values({
      color: mailboxLabelColorSchema.parse(input.color),
      createdAt: now,
      createdByUserId: input.userId,
      description: input.description?.trim() || null,
      id: randomUUID(),
      mailboxId: input.mailboxId,
      name,
      normalizedName: normalizeName(name),
      updatedAt: now,
      updatedByUserId: input.userId,
    })
    .returning();
  return toMailboxLabel(record);
};

export const updateManagedLabel = async (input: {
  color?: string;
  description?: string | null;
  labelId: string;
  mailboxId: string;
  name?: string;
  position?: number;
  userId: string;
  visible?: boolean;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  const name = input.name?.replace(/\s+/g, " ").trim();
  const [record] = await db
    .update(managedMailLabel)
    .set({
      ...(input.color ? { color: mailboxLabelColorSchema.parse(input.color) } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(name ? { name, normalizedName: normalizeName(name) } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.visible !== undefined ? { visible: input.visible } : {}),
      updatedAt: new Date(),
      updatedByUserId: input.userId,
    })
    .where(
      and(eq(managedMailLabel.id, input.labelId), eq(managedMailLabel.mailboxId, input.mailboxId)),
    )
    .returning();
  if (!record) throw new ORPCError("NOT_FOUND", { message: "Label not found." });
  return toMailboxLabel(record);
};

export const reorderManagedLabels = async (input: {
  labelIds: string[];
  mailboxId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  await assertLabelsBelongToMailbox(input.mailboxId, input.labelIds);
  await Promise.all(
    input.labelIds.map((labelId, position) =>
      db
        .update(managedMailLabel)
        .set({ position, updatedAt: new Date(), updatedByUserId: input.userId })
        .where(
          and(eq(managedMailLabel.id, labelId), eq(managedMailLabel.mailboxId, input.mailboxId)),
        ),
    ),
  );
  return { labelIds: input.labelIds };
};

export const deleteManagedLabel = async (input: {
  labelId: string;
  mailboxId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });

  const [label] = await db
    .select({ id: managedMailLabel.id, name: managedMailLabel.name })
    .from(managedMailLabel)
    .where(
      and(eq(managedMailLabel.id, input.labelId), eq(managedMailLabel.mailboxId, input.mailboxId)),
    )
    .limit(1);
  if (!label) throw new ORPCError("NOT_FOUND", { message: "Label not found." });

  const [views, rules] = await Promise.all([
    db
      .select()
      .from(managedMailSavedView)
      .where(eq(managedMailSavedView.mailboxId, input.mailboxId)),
    db.select().from(managedMailRule).where(eq(managedMailRule.mailboxId, input.mailboxId)),
  ]);

  for (const view of views) {
    const search = structuredMailSearchSchema.parse(view.search);
    const nextFilters = search.filters.filter(
      (filter) =>
        !(filter.type === "label" && normalizeName(filter.value) === normalizeName(label.name)),
    );
    if (nextFilters.length !== search.filters.length) {
      await db
        .update(managedMailSavedView)
        .set({
          disabledReason:
            nextFilters.length === 0 && !search.text ? "This view needs new filters." : null,
          search: { ...search, filters: nextFilters },
          updatedAt: new Date(),
        })
        .where(eq(managedMailSavedView.id, view.id));
    }
  }

  for (const rule of rules) {
    if (!rule.labelIds.includes(input.labelId)) continue;
    const labelIds = rule.labelIds.filter((labelId) => labelId !== input.labelId);
    await db
      .update(managedMailRule)
      .set({ enabled: labelIds.length > 0 && rule.enabled, labelIds, updatedAt: new Date() })
      .where(eq(managedMailRule.id, rule.id));
  }

  await db
    .delete(managedMailLabel)
    .where(
      and(eq(managedMailLabel.id, input.labelId), eq(managedMailLabel.mailboxId, input.mailboxId)),
    );
  return { id: input.labelId };
};

const updateManagedMessageLabels = async (input: {
  addLabelIds?: string[];
  mailboxId: string;
  messageIds: string[];
  removeLabelIds?: string[];
  source: "backfill" | "inherited" | "manual" | "rule";
  ruleId?: string;
  userId?: string;
}) => {
  const addLabelIds = Array.from(new Set(input.addLabelIds ?? []));
  const removeLabelIds = Array.from(new Set(input.removeLabelIds ?? []));
  await assertLabelsBelongToMailbox(input.mailboxId, [...addLabelIds, ...removeLabelIds]);

  if (removeLabelIds.length > 0 && input.messageIds.length > 0) {
    await db
      .delete(managedMailMessageLabel)
      .where(
        and(
          eq(managedMailMessageLabel.mailboxId, input.mailboxId),
          inArray(managedMailMessageLabel.messageId, input.messageIds),
          inArray(managedMailMessageLabel.labelId, removeLabelIds),
        ),
      );
  }

  if (addLabelIds.length > 0 && input.messageIds.length > 0) {
    await db
      .insert(managedMailMessageLabel)
      .values(
        input.messageIds.flatMap((messageId) =>
          addLabelIds.map((labelId) => ({
            assignedByUserId: input.userId ?? null,
            createdAt: new Date(),
            id: randomUUID(),
            labelId,
            mailboxId: input.mailboxId,
            messageId,
            ruleId: input.ruleId ?? null,
            source: input.source,
          })),
        ),
      )
      .onConflictDoNothing({
        target: [managedMailMessageLabel.messageId, managedMailMessageLabel.labelId],
      });
  }

  const assignments =
    input.messageIds.length > 0
      ? await db
          .select({
            labelId: managedMailMessageLabel.labelId,
            messageId: managedMailMessageLabel.messageId,
          })
          .from(managedMailMessageLabel)
          .where(inArray(managedMailMessageLabel.messageId, input.messageIds))
      : [];
  const labelIdsByMessageId = new Map<string, string[]>();
  for (const assignment of assignments) {
    const labelIds = labelIdsByMessageId.get(assignment.messageId) ?? [];
    labelIds.push(assignment.labelId);
    labelIdsByMessageId.set(assignment.messageId, labelIds);
  }

  return input.messageIds.map((messageId) => ({
    id: messageId,
    isUnread: false,
    labelIds: labelIdsByMessageId.get(messageId) ?? [],
  }));
};

export const updateManagedThreadLabels = async (input: {
  addLabelIds?: string[];
  mailboxId: string;
  removeLabelIds?: string[];
  threadId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager", "responder"],
    userId: input.userId,
  });
  const messages = await db
    .select({ id: managedMailMessage.id, isRead: managedMailMessage.isRead })
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        eq(managedMailMessage.threadId, input.threadId),
      ),
    );
  if (messages.length === 0) {
    throw new ORPCError("NOT_FOUND", { message: "Message thread not found." });
  }
  const updated = await updateManagedMessageLabels({
    ...input,
    messageIds: messages.map((message) => message.id),
    source: "manual",
  });
  return {
    messages: updated.map((message) => ({
      ...message,
      isUnread: !messages.find((record) => record.id === message.id)!.isRead,
    })),
    threadId: input.threadId,
  };
};

export const updateSingleManagedMessageLabels = async (input: {
  addLabelIds?: string[];
  mailboxId: string;
  messageId: string;
  removeLabelIds?: string[];
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager", "responder"],
    userId: input.userId,
  });
  const [message] = await db
    .select({ id: managedMailMessage.id, isRead: managedMailMessage.isRead })
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        eq(managedMailMessage.id, input.messageId),
      ),
    )
    .limit(1);
  if (!message) throw new ORPCError("NOT_FOUND", { message: "Message not found." });
  const [updated] = await updateManagedMessageLabels({
    ...input,
    messageIds: [message.id],
    source: "manual",
  });
  return { ...updated, isUnread: !message.isRead };
};

export const inheritManagedThreadLabels = async (input: {
  mailboxId: string;
  messageId: string;
  threadId: string;
}) => {
  const assignments = await db
    .selectDistinct({ labelId: managedMailMessageLabel.labelId })
    .from(managedMailMessageLabel)
    .innerJoin(managedMailMessage, eq(managedMailMessage.id, managedMailMessageLabel.messageId))
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        eq(managedMailMessage.threadId, input.threadId),
        ne(managedMailMessage.id, input.messageId),
      ),
    );
  if (assignments.length === 0) return;
  await updateManagedMessageLabels({
    addLabelIds: assignments.map((assignment) => assignment.labelId),
    mailboxId: input.mailboxId,
    messageIds: [input.messageId],
    source: "inherited",
  });
};

const assertViewAccess = async (input: {
  mailboxId: string;
  ownerUserId: string | null;
  userId: string;
}) => {
  const mailbox = await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    userId: input.userId,
  });
  if (input.ownerUserId === null && mailbox.role !== "manager") {
    throw new ORPCError("FORBIDDEN", { message: "Mailbox manager access is required." });
  }
  if (input.ownerUserId !== null && input.ownerUserId !== input.userId) {
    throw new ORPCError("FORBIDDEN", { message: "This personal view belongs to another user." });
  }
};

export const listManagedSavedViews = async (input: { mailboxId: string; userId: string }) => {
  await getAuthorizedManagedMailbox(input);
  return await db
    .select()
    .from(managedMailSavedView)
    .where(
      and(
        eq(managedMailSavedView.mailboxId, input.mailboxId),
        or(
          isNull(managedMailSavedView.ownerUserId),
          eq(managedMailSavedView.ownerUserId, input.userId),
        ),
      ),
    )
    .orderBy(asc(managedMailSavedView.ownerUserId), asc(managedMailSavedView.position));
};

export const createManagedSavedView = async (input: {
  definition: MailboxSavedViewDefinition;
  mailboxId: string;
  shared: boolean;
  userId: string;
}) => {
  const definition = mailboxSavedViewDefinitionSchema.parse(input.definition);
  await assertViewAccess({
    mailboxId: input.mailboxId,
    ownerUserId: input.shared ? null : input.userId,
    userId: input.userId,
  });
  const now = new Date();
  const [record] = await db
    .insert(managedMailSavedView)
    .values({
      color: definition.color,
      createdAt: now,
      icon: definition.icon,
      id: randomUUID(),
      mailboxId: input.mailboxId,
      name: definition.name,
      normalizedName: normalizeName(definition.name),
      ownerUserId: input.shared ? null : input.userId,
      search: definition.search,
      sort: definition.sort,
      updatedAt: now,
    })
    .returning();
  return record;
};

export const updateManagedSavedView = async (input: {
  definition: MailboxSavedViewDefinition;
  mailboxId: string;
  userId: string;
  viewId: string;
}) => {
  const definition = mailboxSavedViewDefinitionSchema.parse(input.definition);
  const [view] = await db
    .select()
    .from(managedMailSavedView)
    .where(
      and(
        eq(managedMailSavedView.id, input.viewId),
        eq(managedMailSavedView.mailboxId, input.mailboxId),
      ),
    )
    .limit(1);
  if (!view) throw new ORPCError("NOT_FOUND", { message: "Saved view not found." });
  await assertViewAccess({
    mailboxId: input.mailboxId,
    ownerUserId: view.ownerUserId,
    userId: input.userId,
  });
  const [updated] = await db
    .update(managedMailSavedView)
    .set({
      color: definition.color,
      disabledReason: null,
      icon: definition.icon,
      name: definition.name,
      normalizedName: normalizeName(definition.name),
      search: definition.search,
      sort: definition.sort,
      updatedAt: new Date(),
    })
    .where(eq(managedMailSavedView.id, view.id))
    .returning();
  return updated;
};

export const deleteManagedSavedView = async (input: {
  mailboxId: string;
  userId: string;
  viewId: string;
}) => {
  const [view] = await db
    .select()
    .from(managedMailSavedView)
    .where(
      and(
        eq(managedMailSavedView.id, input.viewId),
        eq(managedMailSavedView.mailboxId, input.mailboxId),
      ),
    )
    .limit(1);
  if (!view) throw new ORPCError("NOT_FOUND", { message: "Saved view not found." });
  await assertViewAccess({
    mailboxId: input.mailboxId,
    ownerUserId: view.ownerUserId,
    userId: input.userId,
  });
  await db.delete(managedMailSavedView).where(eq(managedMailSavedView.id, view.id));
  return { id: view.id };
};

export const reorderManagedSavedViews = async (input: {
  mailboxId: string;
  userId: string;
  viewIds: string[];
}) => {
  const views =
    input.viewIds.length > 0
      ? await db
          .select()
          .from(managedMailSavedView)
          .where(
            and(
              eq(managedMailSavedView.mailboxId, input.mailboxId),
              inArray(managedMailSavedView.id, input.viewIds),
            ),
          )
      : [];
  if (views.length !== new Set(input.viewIds).size) {
    throw new ORPCError("BAD_REQUEST", { message: "One or more saved views are unavailable." });
  }
  for (const view of views) {
    await assertViewAccess({
      mailboxId: input.mailboxId,
      ownerUserId: view.ownerUserId,
      userId: input.userId,
    });
  }
  await Promise.all(
    input.viewIds.map((viewId, position) =>
      db
        .update(managedMailSavedView)
        .set({ position, updatedAt: new Date() })
        .where(eq(managedMailSavedView.id, viewId)),
    ),
  );
  return { viewIds: input.viewIds };
};

const assertRuleLabels = async (mailboxId: string, definition: ManagedMailboxRuleDefinition) => {
  const parsed = managedMailboxRuleDefinitionSchema.parse(definition);
  await assertLabelsBelongToMailbox(mailboxId, parsed.labelIds);
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
      normalizedName: normalizeName(definition.name),
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
      normalizedName: normalizeName(definition.name),
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

export const applyManagedRulesToMessage = async (input: {
  mailboxId: string;
  messageId: string;
}) => {
  const [message, attachments, rules] = await Promise.all([
    db
      .select()
      .from(managedMailMessage)
      .where(
        and(
          eq(managedMailMessage.id, input.messageId),
          eq(managedMailMessage.mailboxId, input.mailboxId),
        ),
      )
      .limit(1)
      .then((records) => records[0]),
    db
      .select({
        fileName: managedMailAttachment.fileName,
        normalizedFileName: managedMailAttachment.normalizedFileName,
      })
      .from(managedMailAttachment)
      .where(eq(managedMailAttachment.messageId, input.messageId)),
    db
      .select()
      .from(managedMailRule)
      .where(and(eq(managedMailRule.mailboxId, input.mailboxId), eq(managedMailRule.enabled, true)))
      .orderBy(asc(managedMailRule.priority)),
  ]);
  if (!message || message.direction !== "inbound") return;

  for (const rule of rules) {
    const now = new Date();
    try {
      const search = structuredMailSearchSchema.parse(rule.search);
      const matched = matchesManagedMailRule({
        attachments,
        matchMode: rule.matchMode,
        message,
        search,
      });
      if (matched) {
        await updateManagedMessageLabels({
          addLabelIds: rule.labelIds,
          mailboxId: input.mailboxId,
          messageIds: [input.messageId],
          ruleId: rule.id,
          source: "rule",
        });
      }
      await db
        .insert(managedMailRuleApplication)
        .values({
          appliedAt: matched ? now : null,
          createdAt: now,
          id: randomUUID(),
          mailboxId: input.mailboxId,
          matched,
          messageId: input.messageId,
          ruleId: rule.id,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [managedMailRuleApplication.ruleId, managedMailRuleApplication.messageId],
          set: { appliedAt: matched ? now : null, error: null, matched, updatedAt: now },
        });
    } catch (error) {
      await db
        .insert(managedMailRuleApplication)
        .values({
          createdAt: now,
          error: error instanceof Error ? error.message : "Rule evaluation failed.",
          id: randomUUID(),
          mailboxId: input.mailboxId,
          matched: false,
          messageId: input.messageId,
          ruleId: rule.id,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [managedMailRuleApplication.ruleId, managedMailRuleApplication.messageId],
          set: {
            error: error instanceof Error ? error.message : "Rule evaluation failed.",
            matched: false,
            updatedAt: now,
          },
        });
    }
  }
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
        await updateManagedMessageLabels({
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
