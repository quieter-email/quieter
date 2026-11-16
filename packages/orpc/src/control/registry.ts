import type { MailboxCapabilities } from "@quieter/mail/data-plane";
import { z } from "zod";

const identifierSchema = z.string().trim().min(1);

export const controlTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user") }).strict(),
  z
    .object({
      kind: z.literal("mailbox"),
      mailboxId: identifierSchema,
      organizationId: identifierSchema,
    })
    .strict(),
  z
    .object({
      connectionId: identifierSchema,
      kind: z.literal("calendar"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("organization"),
      organizationId: identifierSchema,
    })
    .strict(),
]);

export type ControlTarget = z.infer<typeof controlTargetSchema>;

export const controlScopeSchema = z.enum([
  "mailboxes:read",
  "mail:read",
  "mail:write",
  "calendar:read",
  "organization:read",
  "organization:write",
]);

export type ControlScope = z.infer<typeof controlScopeSchema>;

export const controlMutationRequirements = {
  audit: "protected-operation-outcome",
  confirmation: "exact-action",
  idempotency: "actor-credential-target-operation-payload",
  kind: "mutation",
} as const;

type ControlOperationDefinition = {
  id: string;
  scope: ControlScope;
  target: ControlTarget["kind"];
} & (
  | {
      effect: { kind: "read" };
      capability?: never;
      organizationManager?: never;
    }
  | {
      capability?: keyof MailboxCapabilities;
      effect: typeof controlMutationRequirements;
      organizationManager?: true;
    }
);

export const controlOperations = [
  {
    effect: { kind: "read" },
    id: "mailboxes.list",
    scope: "mailboxes:read",
    target: "user",
  },
  {
    effect: { kind: "read" },
    id: "mail.search",
    scope: "mail:read",
    target: "mailbox",
  },
  {
    effect: { kind: "read" },
    id: "mail.read_thread",
    scope: "mail:read",
    target: "mailbox",
  },
  {
    capability: "canMarkRead",
    effect: controlMutationRequirements,
    id: "mail.set_read",
    scope: "mail:write",
    target: "mailbox",
  },
  {
    effect: { kind: "read" },
    id: "calendar.accounts",
    scope: "calendar:read",
    target: "user",
  },
  {
    effect: { kind: "read" },
    id: "calendar.list",
    scope: "calendar:read",
    target: "calendar",
  },
  {
    effect: { kind: "read" },
    id: "calendar.events",
    scope: "calendar:read",
    target: "calendar",
  },
  {
    effect: { kind: "read" },
    id: "calendar.event",
    scope: "calendar:read",
    target: "calendar",
  },
  {
    effect: { kind: "read" },
    id: "organization.read",
    scope: "organization:read",
    target: "organization",
  },
  {
    effect: controlMutationRequirements,
    id: "organization.settings.update",
    organizationManager: true,
    scope: "organization:write",
    target: "organization",
  },
] as const satisfies readonly ControlOperationDefinition[];

export type ControlOperation = (typeof controlOperations)[number];
export type ControlOperationId = ControlOperation["id"];

export const controlOperationIdSchema = z.enum(
  controlOperations.map((operation) => operation.id)
);
