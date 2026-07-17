import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { user } from "@quieter/database/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { MailboxListItem } from "../../mailbox/types";
import { createGmailLiveSyncConnection } from "../../gmail-live-sync";
import {
  createManagedMailbox,
  getManagedMailboxDetails,
  listManagedMailboxAdministration,
  removeManagedMailboxDivisionGrant,
  removeManagedMailboxGrant,
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
} from "../../mailbox/service";
import {
  backfillApiMessagesForManagedMailbox,
  createManagedMailboxForApiMessage,
} from "../../organization-api-mail";
import { mailboxIdSchema, mailboxSwitcherOrderSchema, protectedProcedure } from "../base";

export const mailboxProcedures = {
  listMailboxes: protectedProcedure.route({ method: "GET" }).handler(async ({ context }) => {
    const [mailboxPreferences, mailboxState] = await Promise.all([
      getUserMailboxPreferences(context.userId),
      listAccessibleMailboxState({ userId: context.userId }),
    ]);
    const orderedGroups = applyMailboxSwitcherOrder(
      mailboxState.groups,
      mailboxPreferences.mailboxSwitcherOrder,
    );
    const allMailboxes: MailboxListItem[] = orderedGroups.flatMap((group) => group.mailboxes);
    return {
      defaultMailboxId: resolveDefaultMailboxId(allMailboxes, mailboxPreferences.defaultMailboxId),
      groups: orderedGroups,
    };
  }),
  listGmailUnreadCounts: protectedProcedure
    .route({ method: "GET" })
    .handler(({ context }) => listAccessibleGmailUnreadCounts({ userId: context.userId })),
  startGmailConnection: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema.optional(),
        organizationId: z.string().trim().min(1).optional(),
        returnTo: z.string().trim().optional(),
      }),
    )
    .handler(async ({ context, input }) => startGmailOAuth({ ...input, userId: context.userId })),
  setGmailAutoLabeling: protectedProcedure
    .input(z.object({ enabled: z.boolean(), mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) => {
      const { setGmailAutoLabeling } = await import("../../gmail-auto-label/settings");
      return setGmailAutoLabeling({ ...input, userId: context.userId });
    }),
  setGmailUsefulDetails: protectedProcedure
    .input(z.object({ enabled: z.boolean(), mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) => {
      const { setGmailUsefulDetails } = await import("../../gmail-useful-details/settings");
      return setGmailUsefulDetails({ ...input, userId: context.userId });
    }),
  listGmailUsefulDetails: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) => {
      const { listGmailUsefulDetails } = await import("../../gmail-useful-details/service");
      return listGmailUsefulDetails({ ...input, userId: context.userId });
    }),
  listGmailThreadUsefulDetails: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        gmailThreadId: z.string().trim().min(1),
        mailboxId: mailboxIdSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      const { listGmailThreadUsefulDetails } = await import("../../gmail-useful-details/service");
      return listGmailThreadUsefulDetails({ ...input, userId: context.userId });
    }),
  dismissGmailUsefulDetail: protectedProcedure
    .input(z.object({ id: z.string().trim().min(1), mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) => {
      const { dismissGmailUsefulDetail } = await import("../../gmail-useful-details/service");
      return dismissGmailUsefulDetail({ ...input, userId: context.userId });
    }),
  setGmailUsefulDetailFeedback: protectedProcedure
    .input(
      z.object({
        feedback: z.enum(["not_useful", "useful"]),
        id: z.string().trim().min(1),
        mailboxId: mailboxIdSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      const { setGmailUsefulDetailFeedback } = await import("../../gmail-useful-details/service");
      return setGmailUsefulDetailFeedback({ ...input, userId: context.userId });
    }),
  createLiveSyncConnection: protectedProcedure
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) =>
      createGmailLiveSyncConnection({ ...input, userId: context.userId }),
    ),
  disconnectMailbox: protectedProcedure
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) =>
      disconnectGmailMailbox({ ...input, userId: context.userId }),
    ),
  moveGmailMailbox: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        organizationId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) => moveGmailMailbox({ ...input, userId: context.userId })),
  createManagedMailbox: protectedProcedure
    .input(
      z.object({
        divisionId: z.string().trim().min(1).nullable().optional(),
        displayName: z.string().trim().max(120).nullable().optional(),
        emailAddress: z.string().trim().email(),
        includeApiSentMessages: z.boolean().optional(),
        organizationId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) =>
      createManagedMailbox({ ...input, userId: context.userId }),
    ),
  getManagedMailboxDetails: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) =>
      getManagedMailboxDetails({ ...input, userId: context.userId }),
    ),
  listManagedMailboxAdministration: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ organizationId: z.string().trim().min(1) }))
    .handler(async ({ context, input }) =>
      listManagedMailboxAdministration({ ...input, userId: context.userId }),
    ),
  updateManagedMailbox: protectedProcedure
    .input(
      z.object({
        displayName: z.string().trim().max(120).nullable().optional(),
        divisionId: z.string().trim().min(1).nullable().optional(),
        includeApiSentMessages: z.boolean().optional(),
        mailboxId: mailboxIdSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      const result = await updateManagedMailbox({ ...input, userId: context.userId });
      if (input.includeApiSentMessages) {
        await backfillApiMessagesForManagedMailbox({
          mailboxId: input.mailboxId,
          userId: context.userId,
        });
      }
      return result;
    }),
  createManagedMailboxForApiMessage: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        messageId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) =>
      createManagedMailboxForApiMessage({ ...input, userId: context.userId }),
    ),
  setManagedMailboxGrant: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        role: z.enum(["reader", "responder", "manager"]),
        userId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) =>
      setManagedMailboxGrant({
        mailboxId: input.mailboxId,
        role: input.role,
        targetUserId: input.userId,
        userId: context.userId,
      }),
    ),
  removeManagedMailboxGrant: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        userId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) =>
      removeManagedMailboxGrant({
        mailboxId: input.mailboxId,
        targetUserId: input.userId,
        userId: context.userId,
      }),
    ),
  setManagedMailboxDivisionGrant: protectedProcedure
    .input(
      z.object({
        divisionId: z.string().trim().min(1),
        mailboxId: mailboxIdSchema,
        role: z.enum(["reader", "responder", "manager"]),
      }),
    )
    .handler(async ({ context, input }) =>
      setManagedMailboxDivisionGrant({ ...input, userId: context.userId }),
    ),
  removeManagedMailboxDivisionGrant: protectedProcedure
    .input(
      z.object({
        divisionId: z.string().trim().min(1),
        mailboxId: mailboxIdSchema,
      }),
    )
    .handler(async ({ context, input }) =>
      removeManagedMailboxDivisionGrant({ ...input, userId: context.userId }),
    ),
  setDefaultMailbox: protectedProcedure
    .input(z.object({ mailboxId: mailboxIdSchema.nullable() }))
    .handler(async ({ context, input }) => {
      if (input.mailboxId) {
        const mailboxState = await listAccessibleMailboxState({ userId: context.userId });
        if (
          !mailboxState.groups.some((group) =>
            group.mailboxes.some((record) => record.id === input.mailboxId),
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
  updateMailboxSwitcherOrder: protectedProcedure
    .input(mailboxSwitcherOrderSchema)
    .handler(async ({ context, input }) => {
      const mailboxState = await listAccessibleMailboxState({ userId: context.userId });
      const canonicalOrder = canonicalizeMailboxSwitcherOrder(mailboxState.groups, input);
      await db
        .update(user)
        .set({ mailboxSwitcherOrder: canonicalOrder, updatedAt: new Date() })
        .where(eq(user.id, context.userId));
      return { mailboxSwitcherOrder: canonicalOrder };
    }),
};
