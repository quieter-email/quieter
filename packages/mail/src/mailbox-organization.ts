import { z } from "zod";

import { autoLabelSettingsSchema } from "./auto-label";
import { structuredMailSearchSchema } from "./search";

export const mailboxLabelNamedColorSchema = z.enum([
  "blue",
  "cyan",
  "green",
  "gray",
  "orange",
  "pink",
  "purple",
  "red",
  "yellow",
]);

export const mailboxLabelColorSchema = z.union([
  mailboxLabelNamedColorSchema,
  z
    .string()
    .regex(/^#[\da-f]{6}$/iu, "Choose a valid hex color.")
    .pipe(z.templateLiteral(["#", z.string()])),
]);

export type MailboxLabelColor = z.infer<typeof mailboxLabelColorSchema>;

export const mailboxLabelSchema = z.object({
  autoLabel: autoLabelSettingsSchema.nullable(),
  color: mailboxLabelColorSchema.nullable(),
  description: z.string().nullable(),
  id: z.string(),
  inclusionCriteria: z.string().nullable(),
  name: z.string(),
  position: z.number(),
  provider: z.enum(["gmail", "managed"]),
  type: z.enum(["system", "user"]),
  visible: z.boolean(),
});

export type MailboxLabel = z.infer<typeof mailboxLabelSchema>;

const labelGroupFields = {
  color: mailboxLabelColorSchema,
  name: z.string().trim().min(1).max(100),
  parentId: z.uuid().nullable(),
};

export const labelOrganizationSchema = z.object({
  groups: z.array(z.object({ ...labelGroupFields, id: z.uuid() })),
  labelGroups: z.record(z.string(), z.uuid()),
});

export type LabelOrganization = z.infer<typeof labelOrganizationSchema>;

export const labelOrganizationActionSchema = z.discriminatedUnion("kind", [
  z.object({ ...labelGroupFields, kind: z.literal("create-group") }),
  z.object({
    ...labelGroupFields,
    groupId: z.uuid(),
    kind: z.literal("update-group"),
  }),
  z.object({ groupId: z.uuid(), kind: z.literal("delete-group") }),
  z.object({
    groupId: z.uuid().nullable(),
    kind: z.literal("move-label"),
    labelId: z.string().trim().min(1).max(512),
  }),
]);

export type LabelOrganizationAction = z.infer<
  typeof labelOrganizationActionSchema
>;

export const emptyLabelOrganization: LabelOrganization = {
  groups: [],
  labelGroups: {},
};

export const applyLabelOrganizationAction = (
  organization: LabelOrganization,
  action: LabelOrganizationAction,
  newGroupId: string
): LabelOrganization | string => {
  const groups = new Map(organization.groups.map((group) => [group.id, group]));
  const labelGroups = new Map(Object.entries(organization.labelGroups));
  if (action.kind === "move-label") {
    if (action.groupId === null) {
      labelGroups.delete(action.labelId);
    } else if (groups.has(action.groupId)) {
      labelGroups.set(action.labelId, action.groupId);
    } else {
      return "Label group not found.";
    }
  } else if (action.kind === "delete-group") {
    const removed = groups.get(action.groupId);
    if (removed) {
      groups.delete(removed.id);
      for (const group of groups.values()) {
        if (group.parentId === removed.id) {
          groups.set(group.id, { ...group, parentId: removed.parentId });
        }
      }
      for (const [labelId, groupId] of labelGroups) {
        if (groupId === removed.id) {
          if (removed.parentId === null) {
            labelGroups.delete(labelId);
          } else {
            labelGroups.set(labelId, removed.parentId);
          }
        }
      }
    }
  } else {
    const id = action.kind === "create-group" ? newGroupId : action.groupId;
    if (action.kind === "update-group" && !groups.has(id)) {
      return "Label group not found.";
    }
    const { color, name, parentId } = action;
    const ancestors = new Set([id]);
    let current = parentId;
    while (current !== null) {
      if (ancestors.has(current)) {
        return "A group cannot be moved inside itself or one of its groups.";
      }
      const parent = groups.get(current);
      if (parent === undefined) {
        return "Parent label group not found.";
      }
      ancestors.add(current);
      current = parent.parentId;
    }
    const children = new Map<string, string[]>();
    for (const group of groups.values()) {
      if (group.parentId !== null) {
        const siblings = children.get(group.parentId) ?? [];
        siblings.push(group.id);
        children.set(group.parentId, siblings);
      }
    }
    const descendants = [{ depth: ancestors.size, id }];
    for (const descendant of descendants) {
      if (descendant.depth > 32) {
        return "Label groups can be nested up to 32 levels.";
      }
      for (const childId of children.get(descendant.id) ?? []) {
        descendants.push({ depth: descendant.depth + 1, id: childId });
      }
    }
    groups.set(id, { color, id, name, parentId });
  }
  return {
    groups: [...groups.values()],
    labelGroups: Object.fromEntries(labelGroups),
  };
};

export const managedMailboxRuleActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("set-read"),
    read: z.boolean(),
  }),
  z.object({
    destination: z.enum(["inbox", "spam", "trash"]),
    kind: z.literal("move"),
  }),
  z
    .object({
      addIds: z.array(z.string().trim().min(1)).max(100),
      kind: z.literal("set-labels"),
      removeIds: z.array(z.string().trim().min(1)).max(100),
    })
    .refine(
      (action) => action.addIds.length > 0 || action.removeIds.length > 0,
      {
        message: "A label action must change at least one label.",
      }
    ),
  z.object({
    includeAttachments: z.boolean().default(false),
    kind: z.literal("forward"),
    recipients: z.array(z.email().trim()).min(1).max(5),
  }),
  z.object({ kind: z.literal("stop-processing") }),
]);

export type ManagedMailboxRuleAction = z.infer<
  typeof managedMailboxRuleActionSchema
>;

export const getManagedMailboxRuleActions = (input: {
  actions?: unknown;
  labelIds?: readonly string[];
}): ManagedMailboxRuleAction[] => {
  const parsed = managedMailboxRuleActionSchema
    .array()
    .safeParse(input.actions);
  if (parsed.success) {
    return parsed.data;
  }

  const labelIds = input.labelIds
    ? [...new Set(input.labelIds.filter((labelId) => labelId.length > 0))]
    : [];
  return labelIds.length > 0
    ? ([
        {
          addIds: labelIds,
          kind: "set-labels",
          removeIds: [],
        },
      ] satisfies ManagedMailboxRuleAction[])
    : [];
};

export const managedMailboxRuleConditionGroupSchema = z.object({
  matchMode: z.enum(["all", "any"]),
  search: structuredMailSearchSchema,
});

export type ManagedMailboxRuleConditionGroup = z.infer<
  typeof managedMailboxRuleConditionGroupSchema
>;

export const managedMailboxRuleDefinitionSchema = z.object({
  actions: z.array(managedMailboxRuleActionSchema).min(1).max(20).optional(),
  conditionGroups: z
    .array(managedMailboxRuleConditionGroupSchema)
    .max(20)
    .optional(),
  enabled: z.boolean(),
  labelIds: z.array(z.string().trim().min(1)).max(100).default([]),
  matchMode: z.enum(["all", "any"]),
  name: z.string().trim().min(1).max(100),
  search: structuredMailSearchSchema,
});

export type ManagedMailboxRuleDefinition = z.infer<
  typeof managedMailboxRuleDefinitionSchema
>;
