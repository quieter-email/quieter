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

export const managedMailboxRuleDefinitionSchema = z.object({
  enabled: z.boolean(),
  labelIds: z.array(z.string().trim().min(1)).min(1),
  matchMode: z.enum(["all", "any"]),
  name: z.string().trim().min(1).max(100),
  search: structuredMailSearchSchema,
});

export type ManagedMailboxRuleDefinition = z.infer<typeof managedMailboxRuleDefinitionSchema>;
