import { z } from "zod";

import {
  collaborationCursorSchema,
  collaborationScopeSchema,
  collaborationStateSchema,
} from "./collaboration";

export const collaborationNoteBodySchema = z
  .string()
  .max(20_000)
  .refine(
    // oxlint-disable-next-line typescript/no-misused-spread -- PostgreSQL char_length counts Unicode code points rather than grapheme clusters.
    (body) => [...body].length <= 10_000,
    "Keep the note within 10,000 characters."
  )
  .refine(
    (body) => body.isWellFormed() && !body.includes("\u0000"),
    "Write valid plain text."
  )
  .refine((body) => /\S/u.test(body), "Write an internal note first.");

export const collaborationNoteParticipantSchema = z.strictObject({
  memberId: z.string().min(1).max(512),
  name: z.string(),
});

export const collaborationNoteSchema = z.strictObject({
  actions: z.strictObject({ edit: z.boolean(), remove: z.boolean() }),
  author: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("member"),
      memberId: z.string(),
      name: z.string(),
    }),
    z.strictObject({ kind: z.literal("former-member") }),
  ]),
  body: collaborationNoteBodySchema,
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  mentions: z.array(collaborationNoteParticipantSchema),
  updatedAt: z.iso.datetime(),
});

export const collaborationNotesPageCursorSchema =
  collaborationCursorSchema.extend({
    createdAt: z.iso.datetime(),
    noteId: z.uuid(),
  });

export const collaborationNotesListInputSchema =
  collaborationScopeSchema.extend({
    after: collaborationNotesPageCursorSchema.optional(),
    at: collaborationCursorSchema.optional(),
  });

export const collaborationNotesPageSchema = z.strictObject({
  next: collaborationNotesPageCursorSchema.nullable(),
  notes: z.array(collaborationNoteSchema),
  snapshot: collaborationStateSchema,
});

export const collaborationNoteGetInputSchema = collaborationScopeSchema.extend({
  contextId: z.uuid(),
  noteId: z.uuid(),
});

export const collaborationNoteResultSchema = z.strictObject({
  note: collaborationNoteSchema.nullable(),
  snapshot: collaborationStateSchema,
});

export const collaborationNoteParticipantsInputSchema =
  collaborationScopeSchema.extend({
    afterMemberId: z.string().min(1).max(512).optional(),
    search: z.string().trim().max(128).optional(),
  });

export const collaborationNoteParticipantsSchema = z.strictObject({
  nextMemberId: z.string().nullable(),
  participants: z.array(collaborationNoteParticipantSchema),
  snapshot: collaborationStateSchema,
});

const selectedMembersSchema = z
  .array(collaborationNoteParticipantSchema.shape.memberId)
  .max(50)
  .refine(
    (members) => new Set(members).size === members.length,
    "Choose each teammate once."
  );

const noteWriteScopeSchema = collaborationScopeSchema.extend({
  expected: collaborationCursorSchema,
  noteId: z.uuid(),
});

export const collaborationNoteCommandSchema = z.discriminatedUnion("kind", [
  noteWriteScopeSchema.extend({
    body: collaborationNoteBodySchema,
    kind: z.literal("create"),
    mentionMemberIds: selectedMembersSchema,
  }),
  noteWriteScopeSchema.extend({
    body: collaborationNoteBodySchema,
    kind: z.literal("edit"),
    mentionMemberIds: selectedMembersSchema,
  }),
  noteWriteScopeSchema.extend({ kind: z.literal("remove") }),
]);

export const collaborationMentionPositionSchema = z.strictObject({
  createdAt: z.iso.datetime(),
  noteId: z.uuid(),
});

export const collaborationMentionsInputSchema = z.strictObject({
  after: collaborationMentionPositionSchema.optional(),
  mailboxId: collaborationScopeSchema.shape.mailboxId,
});

export const collaborationMentionSchema = collaborationScopeSchema.extend({
  contextId: z.uuid(),
  createdAt: z.iso.datetime(),
  href: z.string(),
  noteId: z.uuid(),
});

export const collaborationMentionsPageSchema = z.strictObject({
  mentions: z.array(collaborationMentionSchema),
  next: collaborationMentionPositionSchema.nullable(),
});

export const collaborationMentionAcknowledgementSchema = z.strictObject({
  acknowledged: z.boolean(),
});

export type CollaborationNote = z.infer<typeof collaborationNoteSchema>;
export type CollaborationNoteCommand = z.infer<
  typeof collaborationNoteCommandSchema
>;
export type CollaborationNotesListInput = z.infer<
  typeof collaborationNotesListInputSchema
>;
export type CollaborationNotesPage = z.infer<
  typeof collaborationNotesPageSchema
>;
export type CollaborationNoteGetInput = z.infer<
  typeof collaborationNoteGetInputSchema
>;
export type CollaborationNoteResult = z.infer<
  typeof collaborationNoteResultSchema
>;
export type CollaborationNoteParticipantsInput = z.infer<
  typeof collaborationNoteParticipantsInputSchema
>;
export type CollaborationNoteParticipants = z.infer<
  typeof collaborationNoteParticipantsSchema
>;
export type CollaborationNoteParticipant = z.infer<
  typeof collaborationNoteParticipantSchema
>;
export type CollaborationMentionsInput = z.infer<
  typeof collaborationMentionsInputSchema
>;
export type CollaborationMentionsPage = z.infer<
  typeof collaborationMentionsPageSchema
>;
