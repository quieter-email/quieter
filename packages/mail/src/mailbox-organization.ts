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
};

const labelIdSchema = z.string().trim().min(1).max(512);

export const labelOrganizationSchema = z.object({
  groupOrder: z.array(z.uuid()).optional(),
  groups: z.array(
    z.object({
      ...labelGroupFields,
      id: z.uuid(),
      parentId: z.uuid().nullable(),
    })
  ),
  labelGroups: z.record(z.string(), z.uuid()),
  labelOrder: z.array(labelIdSchema).optional(),
});

export type LabelOrganization = z.infer<typeof labelOrganizationSchema>;

const topLevelGroupFields = {
  ...labelGroupFields,
  parentId: z.null().optional(),
};

export const labelOrganizationActionSchema = z.discriminatedUnion("kind", [
  z.object({ ...topLevelGroupFields, kind: z.literal("create-group") }),
  z.object({
    ...topLevelGroupFields,
    groupId: z.uuid(),
    kind: z.literal("update-group"),
  }),
  z.object({ groupId: z.uuid(), kind: z.literal("delete-group") }),
  z.object({
    beforeGroupId: z.uuid().nullable(),
    groupId: z.uuid(),
    kind: z.literal("move-group"),
  }),
  z.object({
    beforeLabelId: labelIdSchema.nullable().optional(),
    groupId: z.uuid().nullable(),
    kind: z.literal("move-label"),
    labelId: labelIdSchema,
    labelOrder: z.array(labelIdSchema).max(10_000).optional(),
  }),
]);

export type LabelOrganizationAction = z.infer<
  typeof labelOrganizationActionSchema
>;

export const emptyLabelOrganization: LabelOrganization = {
  groups: [],
  labelGroups: {},
};

export const flattenLabelOrganization = (
  organization: LabelOrganization
): LabelOrganization => ({
  ...organization,
  groups: organization.groups.map((group) => ({ ...group, parentId: null })),
});

export const orderMailboxLabels = <TLabel extends Pick<MailboxLabel, "id">>(
  labels: readonly TLabel[],
  labelOrder: readonly string[] = []
): TLabel[] => {
  const ranks = new Map(labelOrder.map((id, rank) => [id, rank]));
  return labels.toSorted(
    (left, right) =>
      (ranks.get(left.id) ?? labelOrder.length) -
      (ranks.get(right.id) ?? labelOrder.length)
  );
};

export const orderLabelGroups = (
  organization: LabelOrganization | undefined
): LabelOrganization["groups"] =>
  orderMailboxLabels(
    (organization?.groups ?? []).toSorted((first, second) =>
      first.name.localeCompare(second.name)
    ),
    organization?.groupOrder
  );

export const applyLabelOrganizationAction = (
  organization: LabelOrganization,
  action: LabelOrganizationAction,
  newGroupId: string
): LabelOrganization | string => {
  const flatOrganization = flattenLabelOrganization(organization);
  const groups = new Map(
    flatOrganization.groups.map((group) => [group.id, group])
  );
  const labelGroups = new Map(Object.entries(organization.labelGroups));
  let { groupOrder, labelOrder } = organization;
  if (action.kind === "move-group") {
    const { beforeGroupId, groupId } = action;
    if (
      !groups.has(groupId) ||
      (beforeGroupId !== null && !groups.has(beforeGroupId))
    ) {
      return "Label group not found.";
    }
    if (beforeGroupId === groupId) {
      return flatOrganization;
    }
    groupOrder = orderLabelGroups(flatOrganization)
      .map(({ id }) => id)
      .filter((id) => id !== groupId);
    const index =
      beforeGroupId === null
        ? groupOrder.length
        : groupOrder.indexOf(beforeGroupId);
    groupOrder.splice(index, 0, groupId);
  } else if (action.kind === "move-label") {
    const beforeLabelId = action.beforeLabelId ?? null;
    if (beforeLabelId === action.labelId) {
      return flatOrganization;
    }
    if (
      beforeLabelId !== null &&
      (labelGroups.get(beforeLabelId) ?? null) !== action.groupId
    ) {
      return "The destination label is in another group.";
    }
    if (action.groupId === null) {
      labelGroups.delete(action.labelId);
    } else if (groups.has(action.groupId)) {
      labelGroups.set(action.labelId, action.groupId);
    } else {
      return "Label group not found.";
    }
    if (
      action.labelOrder !== undefined ||
      beforeLabelId !== null ||
      labelOrder !== undefined
    ) {
      const order = new Set([
        ...(labelOrder ?? []),
        ...(action.labelOrder ?? []),
      ]);
      order.delete(action.labelId);
      if (beforeLabelId === null) {
        labelOrder = [...order, action.labelId];
      } else {
        order.add(beforeLabelId);
        labelOrder = [...order];
        labelOrder.splice(labelOrder.indexOf(beforeLabelId), 0, action.labelId);
      }
    }
  } else if (action.kind === "delete-group") {
    if (groups.delete(action.groupId)) {
      groupOrder = groupOrder?.filter((groupId) => groupId !== action.groupId);
      for (const [labelId, groupId] of labelGroups) {
        if (groupId === action.groupId) {
          labelGroups.delete(labelId);
        }
      }
    }
  } else {
    const id = action.kind === "create-group" ? newGroupId : action.groupId;
    if (action.kind === "update-group" && !groups.has(id)) {
      return "Label group not found.";
    }
    const { color, name } = action;
    groups.set(id, { color, id, name, parentId: null });
  }
  return {
    groupOrder,
    groups: [...groups.values()],
    labelGroups: Object.fromEntries(labelGroups),
    labelOrder,
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
