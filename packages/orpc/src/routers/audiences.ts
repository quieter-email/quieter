import * as contracts from "@quieter/mail/audiences";

import * as audiences from "../audiences/service";
import { protectedProcedure } from "./base";

export const audiencesRouter = {
  create: protectedProcedure
    .input(contracts.audienceCreateInputSchema)
    .output(contracts.audienceSchema)
    .handler(
      async ({ context, input }) =>
        await audiences.create(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  createSegment: protectedProcedure
    .input(contracts.audienceCreateSegmentInputSchema)
    .output(contracts.audienceSegmentSchema)
    .handler(
      async ({ context, input }) =>
        await audiences.createSegment(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  deleteSegment: protectedProcedure
    .input(contracts.audienceDeleteSegmentInputSchema)
    .output(contracts.audienceDeleteSegmentResultSchema)
    .handler(
      async ({ context, input }) =>
        await audiences.deleteSegment(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  get: protectedProcedure
    .route({ method: "GET" })
    .input(contracts.audienceGetInputSchema)
    .output(contracts.audienceSchema)
    .handler(
      async ({ context, input }) =>
        await audiences.get(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  importContacts: protectedProcedure
    .input(contracts.audienceImportContactsInputSchema)
    .output(contracts.audienceImportResultSchema)
    .handler(
      async ({ context, input }) =>
        await audiences.importContacts(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  list: protectedProcedure
    .route({ method: "GET" })
    .input(contracts.audienceListInputSchema)
    .output(contracts.audienceListResultSchema)
    .handler(
      async ({ context, input }) =>
        await audiences.list(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  listContacts: protectedProcedure
    .route({ method: "GET" })
    .input(contracts.audienceListContactsInputSchema)
    .output(contracts.audienceListContactsResultSchema)
    .handler(
      async ({ context, input }) =>
        await audiences.listContacts(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  listHistory: protectedProcedure
    .route({ method: "GET" })
    .input(contracts.audienceListHistoryInputSchema)
    .output(contracts.audienceListHistoryResultSchema)
    .handler(
      async ({ context, input }) =>
        await audiences.listHistory(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  listSegments: protectedProcedure
    .route({ method: "GET" })
    .input(contracts.audienceListSegmentsInputSchema)
    .output(contracts.audienceListSegmentsResultSchema)
    .handler(
      async ({ context, input }) =>
        await audiences.listSegments(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  registerContact: protectedProcedure
    .input(contracts.audienceRegisterContactInputSchema)
    .output(contracts.audienceContactSchema)
    .handler(
      async ({ context, input }) =>
        await audiences.registerContact(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  removeContact: protectedProcedure
    .input(contracts.audienceRemoveContactInputSchema)
    .output(contracts.audienceContactSchema)
    .handler(
      async ({ context, input }) =>
        await audiences.removeContact(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  resubscribeContact: protectedProcedure
    .input(contracts.audienceResubscribeContactInputSchema)
    .output(contracts.audienceContactSchema)
    .handler(
      async ({ context, input }) =>
        await audiences.resubscribeContact(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  setSuppression: protectedProcedure
    .input(contracts.audienceSetSuppressionInputSchema)
    .output(contracts.audienceContactSchema)
    .handler(
      async ({ context, input }) =>
        await audiences.setSuppression(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  unsubscribeContact: protectedProcedure
    .input(contracts.audienceUnsubscribeContactInputSchema)
    .output(contracts.audienceContactSchema)
    .handler(
      async ({ context, input }) =>
        await audiences.unsubscribeContact(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  update: protectedProcedure
    .input(contracts.audienceUpdateInputSchema)
    .output(contracts.audienceSchema)
    .handler(
      async ({ context, input }) =>
        await audiences.update(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  updateContact: protectedProcedure
    .input(contracts.audienceUpdateContactInputSchema)
    .output(contracts.audienceContactSchema)
    .handler(
      async ({ context, input }) =>
        await audiences.updateContact(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  updateSegment: protectedProcedure
    .input(contracts.audienceUpdateSegmentInputSchema)
    .output(contracts.audienceSegmentSchema)
    .handler(
      async ({ context, input }) =>
        await audiences.updateSegment(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
};
