import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { user } from "@quieter/database/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { createGmailLiveSyncConnection } from "../../gmail-live-sync";
import {
  createManagedMailbox,
  getManagedMailboxDetails,
  listManagedMailboxAdministration,
  removeManagedMailboxDivisionGrant,
  removeManagedMailboxGrant,
  setManagedMailboxAccessMode,
  setManagedMailboxDivisionGrant,
  setManagedMailboxGrant,
  updateManagedMailbox,
} from "../../mailbox/managed-grants";
import {
  applyMailboxSwitcherOrder,
  canonicalizeMailboxSwitcherOrder,
  getUserMailboxPreferences,
  resolveDefaultMailboxId,
} from "../../mailbox/preferences";
import {
  disconnectGmailMailbox,
  listAccessibleGmailUnreadCounts,
  listAccessibleMailboxState,
  moveGmailMailbox,
  startGmailOAuth,
  updateGmailMailboxDisplayName,
  updateMailboxSignature,
} from "../../mailbox/service";
import type { MailboxListItem } from "../../mailbox/types";
import {
  backfillApiMessagesForManagedMailbox,
  createManagedMailboxForApiMessage,
} from "../../organization-api-mail";
import {
  mailboxIdSchema,
  mailboxSwitcherOrderSchema,
  protectedProcedure,
} from "../base";

export const mailboxProcedures = {
  createLiveSyncConnection: protectedProcedure
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(
      async ({ context, input }) =>
        await createGmailLiveSyncConnection({
          ...input,
          userId: context.userId,
        })
    ),
  createManagedMailbox: protectedProcedure
    .input(
      z.object({
        accessMode: z.enum(["private", "shared"]).optional(),
        displayName: z.string().trim().max(120).nullable().optional(),
        divisionId: z.string().trim().min(1).nullable().optional(),
        emailAddress: z.email(),
        includeApiSentMessages: z.boolean().optional(),
        organizationId: z.string().trim().min(1),
        ownerUserId: z.string().trim().min(1).nullish(),
      })
    )
    .handler(
      async ({ context, input }) =>
        await createManagedMailbox({ ...input, userId: context.userId })
    ),
  createManagedMailboxForApiMessage: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        messageId: z.string().trim().min(1),
      })
    )
    .handler(
      async ({ context, input }) =>
        await createManagedMailboxForApiMessage({
          ...input,
          userId: context.userId,
        })
    ),
  disconnectMailbox: protectedProcedure
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(
      async ({ context, input }) =>
        await disconnectGmailMailbox({ ...input, userId: context.userId })
    ),
  dismissGmailUsefulDetail: protectedProcedure
    .input(
      z.object({ id: z.string().trim().min(1), mailboxId: mailboxIdSchema })
    )
    .handler(async ({ context, input }) => {
      const { dismissGmailUsefulDetail } =
        await import("../../gmail-useful-details/service");
      return await dismissGmailUsefulDetail({
        ...input,
        userId: context.userId,
      });
    }),
  getManagedMailboxDetails: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(
      async ({ context, input }) =>
        await getManagedMailboxDetails({ ...input, userId: context.userId })
    ),
  listGmailThreadUsefulDetails: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        gmailThreadId: z.string().trim().min(1),
        mailboxId: mailboxIdSchema,
      })
    )
    .handler(async ({ context, input }) => {
      const { listGmailThreadUsefulDetails } =
        await import("../../gmail-useful-details/service");
      return await listGmailThreadUsefulDetails({
        ...input,
        userId: context.userId,
      });
    }),
  listGmailUnreadCounts: protectedProcedure
    .route({ method: "GET" })
    .handler(
      async ({ context }) =>
        await listAccessibleGmailUnreadCounts({ userId: context.userId })
    ),
  listGmailUsefulDetails: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) => {
      const { listGmailUsefulDetails } =
        await import("../../gmail-useful-details/service");
      return await listGmailUsefulDetails({ ...input, userId: context.userId });
    }),
  listMailboxes: protectedProcedure
    .route({ method: "GET" })
    .handler(async ({ context }) => {
      const [mailboxPreferences, mailboxState] = await Promise.all([
        getUserMailboxPreferences(context.userId),
        listAccessibleMailboxState({ userId: context.userId }),
      ]);
      const orderedGroups = applyMailboxSwitcherOrder(
        mailboxState.groups,
        mailboxPreferences.mailboxSwitcherOrder
      );
      const allMailboxes: MailboxListItem[] = orderedGroups.flatMap(
        (group) => group.mailboxes
      );
      return {
        defaultMailboxId: resolveDefaultMailboxId(
          allMailboxes,
          mailboxPreferences.defaultMailboxId
        ),
        groups: orderedGroups,
      };
    }),
  listManagedMailboxAdministration: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ organizationId: z.string().trim().min(1) }))
    .handler(
      async ({ context, input }) =>
        await listManagedMailboxAdministration({
          ...input,
          userId: context.userId,
        })
    ),
  moveGmailMailbox: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        organizationId: z.string().trim().min(1),
      })
    )
    .handler(
      async ({ context, input }) =>
        await moveGmailMailbox({ ...input, userId: context.userId })
    ),
  removeManagedMailboxDivisionGrant: protectedProcedure
    .input(
      z.object({
        divisionId: z.string().trim().min(1),
        mailboxId: mailboxIdSchema,
      })
    )
    .handler(
      async ({ context, input }) =>
        await removeManagedMailboxDivisionGrant({
          ...input,
          userId: context.userId,
        })
    ),
  removeManagedMailboxGrant: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        userId: z.string().trim().min(1),
      })
    )
    .handler(
      async ({ context, input }) =>
        await removeManagedMailboxGrant({
          mailboxId: input.mailboxId,
          targetUserId: input.userId,
          userId: context.userId,
        })
    ),
  setDefaultMailbox: protectedProcedure
    .input(z.object({ mailboxId: mailboxIdSchema.nullable() }))
    .handler(async ({ context, input }) => {
      if (input.mailboxId !== null && input.mailboxId.length > 0) {
        const mailboxState = await listAccessibleMailboxState({
          userId: context.userId,
        });
        if (
          !mailboxState.groups.some((group) =>
            group.mailboxes.some((record) => record.id === input.mailboxId)
          )
        ) {
          throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
        }
      }
      await db
        .update(user)
        .set({ defaultMailboxId: input.mailboxId, updatedAt: new Date() })
        .where(eq(user.id, context.userId));
      return { defaultMailboxId: input.mailboxId };
    }),
  setGmailAutoLabeling: protectedProcedure
    .input(z.object({ enabled: z.boolean(), mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) => {
      const { setGmailAutoLabeling } =
        await import("../../gmail-auto-label/settings");
      return await setGmailAutoLabeling({ ...input, userId: context.userId });
    }),
  setGmailUsefulDetailFeedback: protectedProcedure
    .input(
      z.object({
        feedback: z.enum(["not_useful", "useful"]),
        id: z.string().trim().min(1),
        mailboxId: mailboxIdSchema,
      })
    )
    .handler(async ({ context, input }) => {
      const { setGmailUsefulDetailFeedback } =
        await import("../../gmail-useful-details/service");
      return await setGmailUsefulDetailFeedback({
        ...input,
        userId: context.userId,
      });
    }),
  setGmailUsefulDetails: protectedProcedure
    .input(z.object({ enabled: z.boolean(), mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) => {
      const { setGmailUsefulDetails } =
        await import("../../gmail-useful-details/settings");
      return await setGmailUsefulDetails({ ...input, userId: context.userId });
    }),
  setManagedMailboxAccessMode: protectedProcedure
    .input(
      z.object({
        accessMode: z.enum(["private", "shared"]),
        mailboxId: mailboxIdSchema,
        ownerUserId: z.string().trim().min(1).nullish(),
      })
    )
    .handler(
      async ({ context, input }) =>
        await setManagedMailboxAccessMode({ ...input, userId: context.userId })
    ),
  setManagedMailboxDivisionGrant: protectedProcedure
    .input(
      z.object({
        divisionId: z.string().trim().min(1),
        mailboxId: mailboxIdSchema,
        role: z.enum(["reader", "responder", "manager"]),
      })
    )
    .handler(
      async ({ context, input }) =>
        await setManagedMailboxDivisionGrant({
          ...input,
          userId: context.userId,
        })
    ),
  setManagedMailboxGrant: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        role: z.enum(["reader", "responder", "manager"]),
        userId: z.string().trim().min(1),
      })
    )
    .handler(
      async ({ context, input }) =>
        await setManagedMailboxGrant({
          mailboxId: input.mailboxId,
          role: input.role,
          targetUserId: input.userId,
          userId: context.userId,
        })
    ),
  startGmailConnection: protectedProcedure
    .input(
      z.object({
        loginHint: z.email().optional(),
        mailboxId: mailboxIdSchema.optional(),
        organizationId: z.string().trim().min(1).optional(),
        returnTo: z.string().trim().optional(),
      })
    )
    .handler(
      async ({ context, input }) =>
        await startGmailOAuth({ ...input, userId: context.userId })
    ),
  updateGmailMailboxDisplayName: protectedProcedure
    .input(
      z.object({
        displayName: z.string().trim().max(120).nullable(),
        mailboxId: mailboxIdSchema,
      })
    )
    .handler(
      async ({ context, input }) =>
        await updateGmailMailboxDisplayName({
          ...input,
          userId: context.userId,
        })
    ),
  updateMailboxSignature: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        signatureHtml: z.string().max(20_000).nullable(),
        signatureText: z.string().max(10_000).nullable(),
      })
    )
    .handler(
      async ({ context, input }) =>
        await updateMailboxSignature({ ...input, userId: context.userId })
    ),
  updateMailboxSwitcherOrder: protectedProcedure
    .input(mailboxSwitcherOrderSchema)
    .handler(async ({ context, input }) => {
      const mailboxState = await listAccessibleMailboxState({
        userId: context.userId,
      });
      const canonicalOrder = canonicalizeMailboxSwitcherOrder(
        mailboxState.groups,
        input
      );
      await db
        .update(user)
        .set({ mailboxSwitcherOrder: canonicalOrder, updatedAt: new Date() })
        .where(eq(user.id, context.userId));
      return { mailboxSwitcherOrder: canonicalOrder };
    }),
  updateManagedMailbox: protectedProcedure
    .input(
      z.object({
        displayName: z.string().trim().max(120).nullable().optional(),
        divisionId: z.string().trim().min(1).nullable().optional(),
        includeApiSentMessages: z.boolean().optional(),
        mailboxId: mailboxIdSchema,
      })
    )
    .handler(async ({ context, input }) => {
      const result = await updateManagedMailbox({
        ...input,
        userId: context.userId,
      });
      if (input.includeApiSentMessages === true) {
        await backfillApiMessagesForManagedMailbox({
          mailboxId: input.mailboxId,
          userId: context.userId,
        });
      }
      return result;
    }),
};
