import {
  collaborationChangesInputSchema,
  collaborationChangesSchema,
  collaborationScopeSchema,
  collaborationStateSchema,
} from "@quieter/mail/collaboration";

import {
  getCollaboration,
  getCollaborationChanges,
  prepareCollaboration,
} from "../mailbox/collaboration/service";
import { protectedProcedure } from "./base";

export const collaborationRouter = {
  changes: protectedProcedure
    .route({ method: "GET" })
    .input(collaborationChangesInputSchema)
    .output(collaborationChangesSchema)
    .handler(
      async ({ context, input }) =>
        await getCollaborationChanges({ ...input, userId: context.userId })
    ),
  get: protectedProcedure
    .route({ method: "GET" })
    .input(collaborationScopeSchema)
    .output(collaborationStateSchema)
    .handler(
      async ({ context, input }) =>
        await getCollaboration({ ...input, userId: context.userId })
    ),
  prepare: protectedProcedure
    .input(collaborationScopeSchema)
    .output(collaborationStateSchema)
    .handler(
      async ({ context, input }) =>
        await prepareCollaboration({ ...input, userId: context.userId })
    ),
};
