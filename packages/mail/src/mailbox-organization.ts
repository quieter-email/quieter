import { z } from "zod";
import { structuredMailSearchSchema } from "./search";

export const mailboxLabelColorSchema = z.enum([
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

export type MailboxLabelColor = z.infer<typeof mailboxLabelColorSchema>;

export type MailboxLabel = {
  color: MailboxLabelColor | null;
  description: string | null;
  id: string;
  inclusionCriteria: string | null;
  name: string;
  position: number;
  provider: "gmail" | "managed";
  type: "system" | "user";
  visible: boolean;
};

export const mailboxSavedViewDefinitionSchema = z.object({
  color: mailboxLabelColorSchema.nullable(),
  icon: z.string().trim().max(64).nullable(),
  name: z.string().trim().min(1).max(100),
  search: structuredMailSearchSchema,
  sort: z.enum(["newest", "oldest", "relevance"]).default("newest"),
});

export type MailboxSavedViewDefinition = z.infer<typeof mailboxSavedViewDefinitionSchema>;

export const managedMailboxRuleActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("set-read"),
    read: z.boolean(),
  }),
  z.object({
    destination: z.enum(["archive", "inbox", "spam", "trash"]),
    kind: z.literal("move"),
  }),
  z
    .object({
      addIds: z.array(z.string().trim().min(1)).max(100),
      kind: z.literal("set-labels"),
      removeIds: z.array(z.string().trim().min(1)).max(100),
    })
    .refine((action) => action.addIds.length > 0 || action.removeIds.length > 0, {
      message: "A label action must change at least one label.",
    }),
  z.object({
    includeAttachments: z.boolean().default(false),
    kind: z.literal("forward"),
    recipients: z.array(z.email().trim()).min(1).max(5),
  }),
  z.object({ kind: z.literal("stop-processing") }),
]);

export type ManagedMailboxRuleAction = z.infer<typeof managedMailboxRuleActionSchema>;

export const getManagedMailboxRuleActions = (
  input: {
    actions?: unknown;
    labelIds?: readonly string[];
  },
  options: { allowEmpty?: boolean } = {},
) => {
  const parsed = managedMailboxRuleActionSchema.array().safeParse(input.actions);
  if (parsed.success && (parsed.data.length > 0 || options.allowEmpty)) return parsed.data;

  const labelIds = Array.from(new Set(input.labelIds ?? [])).filter(Boolean);
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
  conditionGroups: z.array(managedMailboxRuleConditionGroupSchema).max(20).optional(),
  enabled: z.boolean(),
  labelIds: z.array(z.string().trim().min(1)).max(100).default([]),
  matchMode: z.enum(["all", "any"]),
  name: z.string().trim().min(1).max(100),
  search: structuredMailSearchSchema,
});

export type ManagedMailboxRuleDefinition = z.infer<typeof managedMailboxRuleDefinitionSchema>;
