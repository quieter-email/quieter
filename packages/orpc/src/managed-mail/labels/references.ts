import { ORPCError } from "@orpc/server";
import type { DatabaseExecutor } from "@quieter/database/client";
import { managedMailLabel, managedMailRule } from "@quieter/database/schema";
import {
  managedMailboxRuleActionSchema,
  managedMailboxRuleConditionGroupSchema,
} from "@quieter/mail/mailbox-organization";
import { structuredMailSearchSchema } from "@quieter/mail/search";
import type { StructuredMailSearch } from "@quieter/mail/search";
import { asc, eq } from "drizzle-orm";

import { normalizeManagedOrganizationName } from "../organization/normalize-name";

export const resolveManagedSearchLabels = async (
  database: DatabaseExecutor,
  mailboxId: string,
  search: StructuredMailSearch
): Promise<StructuredMailSearch> => {
  if (!search.filters.some((filter) => filter.type === "label")) {
    return search;
  }
  const labels = await database
    .select()
    .from(managedMailLabel)
    .where(eq(managedMailLabel.mailboxId, mailboxId))
    .orderBy(asc(managedMailLabel.id))
    .for("share");
  return {
    ...search,
    filters: search.filters.map((filter) => {
      if (filter.type !== "label") {
        return filter;
      }
      const label = labels.find(
        (candidate) =>
          candidate.id === filter.value ||
          candidate.normalizedName ===
            normalizeManagedOrganizationName(filter.value)
      );
      if (label === undefined) {
        throw new ORPCError("BAD_REQUEST", {
          message: `The label “${filter.value}” is unavailable. Choose another label.`,
        });
      }
      return { ...filter, value: label.id };
    }),
  };
};

export const updateManagedLabelReferences = async (
  database: DatabaseExecutor,
  label: Pick<
    typeof managedMailLabel.$inferSelect,
    "id" | "mailboxId" | "normalizedName"
  >,
  deleted: boolean
) => {
  const rules = await database
    .select()
    .from(managedMailRule)
    .where(eq(managedMailRule.mailboxId, label.mailboxId))
    .for("update");
  for (const rule of rules) {
    let affected =
      rule.labelIds.includes(label.id) ||
      managedMailboxRuleActionSchema
        .array()
        .parse(rule.actions ?? [])
        .some(
          (action) =>
            action.kind === "set-labels" &&
            (action.addIds.includes(label.id) ||
              action.removeIds.includes(label.id))
        );
    const groups = managedMailboxRuleConditionGroupSchema
      .array()
      .parse(rule.conditionGroups ?? []);
    const searches = [
      structuredMailSearchSchema.parse(rule.search),
      ...groups.map((group) => group.search),
    ].map((search) => ({
      ...search,
      filters: search.filters.map((filter) => {
        if (
          filter.type !== "label" ||
          (filter.value !== label.id &&
            normalizeManagedOrganizationName(filter.value) !==
              label.normalizedName)
        ) {
          return filter;
        }
        affected = true;
        return { ...filter, value: label.id };
      }),
    }));
    if (affected) {
      await database
        .update(managedMailRule)
        .set({
          conditionGroups: groups.map((group, index) => ({
            ...group,
            search: searches[index + 1],
          })),
          disabledReason: deleted
            ? "A label used by this rule was deleted. Update its conditions and actions."
            : rule.disabledReason,
          enabled: deleted ? false : rule.enabled,
          search: searches[0],
          updatedAt: new Date(),
        })
        .where(eq(managedMailRule.id, rule.id));
    }
  }
};
