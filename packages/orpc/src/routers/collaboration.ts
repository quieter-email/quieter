import {
  collaborationChangesInputSchema,
  collaborationChangesSchema,
  collaborationScopeSchema,
  collaborationStateSchema,
} from "@quieter/mail/collaboration";
import {
  collaborationMentionAcknowledgementSchema,
  collaborationMentionsInputSchema,
  collaborationMentionsPageSchema,
  collaborationNoteCommandSchema,
  collaborationNoteGetInputSchema,
  collaborationNoteParticipantsInputSchema,
  collaborationNoteParticipantsSchema,
  collaborationNoteResultSchema,
  collaborationNotesListInputSchema,
  collaborationNotesPageSchema,
} from "@quieter/mail/collaboration-notes";

import {
  acknowledgeCollaborationMention,
  getCollaborationNote,
  listCollaborationMentions,
  listCollaborationNoteParticipants,
  listCollaborationNotes,
  mutateCollaborationNote,
} from "../mailbox/collaboration/notes";
import {
  getCollaboration,
  getCollaborationChanges,
  prepareCollaboration,
} from "../mailbox/collaboration/service";
import { protectedProcedure } from "./base";

const collaborationProcedure = protectedProcedure.use(
  async ({ context, next }) => {
    context.resHeaders?.set("cache-control", "private, no-store");
    return await next();
  }
);

export const collaborationRouter = {
  changes: collaborationProcedure
    .route({ method: "GET" })
    .input(collaborationChangesInputSchema)
    .output(collaborationChangesSchema)
    .handler(
      async ({ context, input }) =>
        await getCollaborationChanges({ ...input, userId: context.userId })
    ),
  get: collaborationProcedure
    .route({ method: "GET" })
    .input(collaborationScopeSchema)
    .output(collaborationStateSchema)
    .handler(
      async ({ context, input }) =>
        await getCollaboration({ ...input, userId: context.userId })
    ),
  mentions: {
    acknowledge: collaborationProcedure
      .input(collaborationNoteGetInputSchema)
      .output(collaborationMentionAcknowledgementSchema)
      .handler(
        async ({ context, input }) =>
          await acknowledgeCollaborationMention({
            ...input,
            userId: context.userId,
          })
      ),
    list: collaborationProcedure
      .route({ method: "GET" })
      .input(collaborationMentionsInputSchema)
      .output(collaborationMentionsPageSchema)
      .handler(
        async ({ context, input }) =>
          await listCollaborationMentions({ ...input, userId: context.userId })
      ),
  },
  notes: {
    get: collaborationProcedure
      .route({ method: "GET" })
      .input(collaborationNoteGetInputSchema)
      .output(collaborationNoteResultSchema)
      .handler(
        async ({ context, input }) =>
          await getCollaborationNote({ ...input, userId: context.userId })
      ),
    list: collaborationProcedure
      .route({ method: "GET" })
      .input(collaborationNotesListInputSchema)
      .output(collaborationNotesPageSchema)
      .handler(
        async ({ context, input }) =>
          await listCollaborationNotes({ ...input, userId: context.userId })
      ),
    mutate: collaborationProcedure
      .input(collaborationNoteCommandSchema)
      .output(collaborationNoteResultSchema)
      .handler(
        async ({ context, input }) =>
          await mutateCollaborationNote({ ...input, userId: context.userId })
      ),
    participants: collaborationProcedure
      .route({ method: "GET" })
      .input(collaborationNoteParticipantsInputSchema)
      .output(collaborationNoteParticipantsSchema)
      .handler(
        async ({ context, input }) =>
          await listCollaborationNoteParticipants({
            ...input,
            userId: context.userId,
          })
      ),
  },
  prepare: collaborationProcedure
    .input(collaborationScopeSchema)
    .output(collaborationStateSchema)
    .handler(
      async ({ context, input }) =>
        await prepareCollaboration({ ...input, userId: context.userId })
    ),
};
