import type { managedMailRule } from "@quieter/database/schema";
import {
  getManagedMailboxRuleActions,
  managedMailboxRuleDefinitionSchema,
  managedMailboxRuleActionSchema,
} from "@quieter/mail/mailbox-organization";
import { z } from "zod";

import { hashRequest } from "../../request-hash";

export const managedRuleSnapshotSchema =
  managedMailboxRuleDefinitionSchema.extend({
    actions: managedMailboxRuleActionSchema.array().min(1).max(20),
    id: z.string(),
    ownerUserId: z.string().nullable(),
    revision: z.string(),
  });

export type ManagedRuleSnapshot = z.infer<typeof managedRuleSnapshotSchema>;

export const snapshotManagedRule = (
  rule: typeof managedMailRule.$inferSelect
): ManagedRuleSnapshot => {
  const definition = managedMailboxRuleDefinitionSchema.parse({
    ...rule,
    actions: getManagedMailboxRuleActions(rule),
    conditionGroups: rule.conditionGroups ?? [],
  });
  const ownerUserId = rule.updatedByUserId ?? rule.createdByUserId;
  return managedRuleSnapshotSchema.parse({
    ...definition,
    id: rule.id,
    ownerUserId,
    revision: hashRequest({
      actions: definition.actions,
      conditionGroups: definition.conditionGroups,
      matchMode: definition.matchMode,
      ownerUserId,
      search: definition.search,
    }),
  });
};
