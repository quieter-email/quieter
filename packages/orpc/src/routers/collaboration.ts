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
  prepare: collaborationProcedure
    .input(collaborationScopeSchema)
    .output(collaborationStateSchema)
    .handler(
      async ({ context, input }) =>
        await prepareCollaboration({ ...input, userId: context.userId })
    ),
};
