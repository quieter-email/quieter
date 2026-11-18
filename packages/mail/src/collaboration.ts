import { z } from "zod";

export const collaborationScopeSchema = z.strictObject({
  mailboxId: z.string().min(1).max(512),
  threadId: z.string().min(1).max(512),
});

export const collaborationCursorSchema = z.strictObject({
  contextId: z.uuid(),
  revision: z.string().regex(/^[1-9]\d{0,18}$/u),
});

export const collaborationPermissionsSchema = z.strictObject({
  assignOthers: z.boolean(),
  claimSelf: z.boolean(),
  moderateNotes: z.boolean(),
  read: z.literal(true),
  writeOwnNotes: z.boolean(),
});

export const collaborationStateSchema = z.strictObject({
  href: z.string(),
  mailboxId: collaborationScopeSchema.shape.mailboxId,
  permissions: collaborationPermissionsSchema,
  role: z.enum(["reader", "responder", "manager"]),
  state: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("unprepared") }),
    z.strictObject({
      cursor: collaborationCursorSchema,
      kind: z.literal("prepared"),
    }),
  ]),
  threadId: collaborationScopeSchema.shape.threadId,
});

export const collaborationChangesInputSchema = collaborationScopeSchema.extend({
  after: collaborationCursorSchema.optional(),
});

export const collaborationChangesSchema = z.strictObject({
  changed: z.boolean(),
  reset: z.boolean(),
  snapshot: collaborationStateSchema,
});

export type CollaborationScope = z.infer<typeof collaborationScopeSchema>;
export type CollaborationCursor = z.infer<typeof collaborationCursorSchema>;
export type CollaborationPermissions = z.infer<
  typeof collaborationPermissionsSchema
>;
export type CollaborationState = z.infer<typeof collaborationStateSchema>;
export type CollaborationChangesInput = z.infer<
  typeof collaborationChangesInputSchema
>;
export type CollaborationChanges = z.infer<typeof collaborationChangesSchema>;

export const compareCollaborationCursor = (
  current: CollaborationState["state"],
  after?: CollaborationCursor
): Pick<CollaborationChanges, "changed" | "reset"> => {
  if (after === undefined) {
    return { changed: true, reset: false };
  }
  if (
    current.kind === "unprepared" ||
    current.cursor.contextId !== after.contextId
  ) {
    return { changed: true, reset: true };
  }
  const currentRevision = BigInt(current.cursor.revision);
  const previousRevision = BigInt(after.revision);
  return {
    changed: currentRevision !== previousRevision,
    reset: previousRevision > currentRevision,
  };
};
