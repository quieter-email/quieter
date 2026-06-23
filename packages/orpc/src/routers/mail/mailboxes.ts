import { ORPCError } from "@orpc/server";
import { db, user } from "@quieter/database";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { MailboxListItem } from "../../mailbox/types";
import { setGmailAutoLabeling } from "../../gmail-auto-label/settings";
import { createGmailLiveSyncConnection } from "../../gmail-live-sync";
import {
  dismissGmailUsefulDetail,
  listGmailThreadUsefulDetails,
  listGmailUsefulDetails,
  setGmailUsefulDetailFeedback,
} from "../../gmail-useful-details/service";
import { setGmailUsefulDetails } from "../../gmail-useful-details/settings";
import {
  createManagedMailbox,
  removeManagedMailboxGrant,
  setManagedMailboxGrant,
} from "../../mailbox/managed-grants";
import {
  applyMailboxSwitcherOrder,
  canonicalizeMailboxSwitcherOrder,
  getUserMailboxPreferences,
  resolveDefaultMailboxId,
} from "../../mailbox/preferences";
import {
  disconnectGmailMailbox,
  listAccessibleMailboxState,
  moveGmailMailbox,
  startGmailOAuth,
} from "../../mailbox/service";
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
    .handler(async ({ context, input }) =>
      setGmailAutoLabeling({ ...input, userId: context.userId }),
    ),
  setGmailUsefulDetails: protectedProcedure
    .input(z.object({ enabled: z.boolean(), mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) =>
      setGmailUsefulDetails({ ...input, userId: context.userId }),
    ),
  listGmailUsefulDetails: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) =>
      listGmailUsefulDetails({ ...input, userId: context.userId }),
    ),
  listGmailThreadUsefulDetails: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        gmailThreadId: z.string().trim().min(1),
        mailboxId: mailboxIdSchema,
      }),
    )
    .handler(async ({ context, input }) =>
      listGmailThreadUsefulDetails({ ...input, userId: context.userId }),
    ),
  dismissGmailUsefulDetail: protectedProcedure
    .input(z.object({ id: z.string().trim().min(1), mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) =>
      dismissGmailUsefulDetail({ ...input, userId: context.userId }),
    ),
  setGmailUsefulDetailFeedback: protectedProcedure
    .input(
      z.object({
        feedback: z.enum(["not_useful", "useful"]),
        id: z.string().trim().min(1),
        mailboxId: mailboxIdSchema,
      }),
    )
    .handler(async ({ context, input }) =>
      setGmailUsefulDetailFeedback({ ...input, userId: context.userId }),
    ),
  createGmailLiveSyncConnection: protectedProcedure
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
        displayName: z.string().trim().max(120).nullable().optional(),
        emailAddress: z.string().trim().email(),
        organizationId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) =>
      createManagedMailbox({ ...input, userId: context.userId }),
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
