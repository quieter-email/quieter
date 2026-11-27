import type { db } from "@quieter/database/client";
import { user } from "@quieter/database/schema";
import { labelOrganizationActionSchema } from "@quieter/mail/mailbox-organization";
import { mailSnoozeApplySchema } from "@quieter/mail/snooze";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getMailCaptureStatus } from "../mail-capture";
import { withMailUpdate } from "../mail-updates";
import { composeMailOperations } from "../mail/compose";
import { mailInputSchemas } from "../mail/inputs";
import type { MailInputs } from "../mail/inputs";
import {
  getLabelOrganization,
  updateLabelOrganization,
} from "../mail/label-organization";
import { listLabelSuggestions } from "../mail/label-suggestions";
import { labelsMailOperations } from "../mail/labels";
import { mutationsMailOperations } from "../mail/mutations";
import { queriesMailOperations } from "../mail/queries";
import { listRecipientSuggestions } from "../mail/recipient-suggestions";
import {
  createHeldSend,
  getHeldSend,
  undoHeldSend,
} from "../scheduled-send/service";
import { applyMailSnooze } from "../snooze/service";
import { protectedProcedure } from "./base";
import { mailboxProcedures } from "./mail/mailboxes";
import { managedOrganizationMailRouter } from "./mail/managed-organization";

const journaledMessageChanges = {
  trackedByGmail: true,
  trackedByManaged: true,
};
const managedMessageChanges = { trackedByManaged: true };

const dispatchOrdinaryMail = async ({
  context,
  mailboxId,
  message,
}: {
  context: {
    db: typeof db;
    signal?: AbortSignal;
    userId: string;
  };
  mailboxId: string;
  message: MailInputs["sendMessage"]["message"];
}) => {
  const [preferences] = await context.db
    .select({ undoSendEnabled: user.undoSendEnabled })
    .from(user)
    .where(eq(user.id, context.userId))
    .limit(1);
  if (preferences?.undoSendEnabled === false) {
    const sendOperationId = message.sendOperationId ?? message.localId;
    const sent = await withMailUpdate(
      composeMailOperations.sendMessage,
      "mailbox.changed",
      managedMessageChanges
    )({
      context,
      input: { mailboxId, message },
    });
    return {
      canUndo: false,
      draftId: null,
      errorMessage: null,
      id: sent.id,
      mailboxId,
      remainingMs: 0,
      sendOperationId,
      status: "accepted" as const,
      undoUntil: null,
    };
  }
  return await createHeldSend({
    mailboxId,
    message,
    userId: context.userId,
  });
};

export const mailRouter = {
  ...mailboxProcedures,
  ...managedOrganizationMailRouter,
  applyChanges: protectedProcedure.input(mailInputSchemas.applyChanges).handler(
    withMailUpdate(mutationsMailOperations.applyChanges, "mailbox.changed", {
      trackedByGmail: ({ command }) => command.kind !== "set-placement",
      trackedByManaged: true,
    })
  ),
  applySnooze: protectedProcedure
    .input(mailSnoozeApplySchema)
    .handler(
      withMailUpdate(applyMailSnooze, "mailbox.changed", managedMessageChanges)
    ),
  createLabel: protectedProcedure
    .input(mailInputSchemas.createLabel)
    .handler(
      withMailUpdate(labelsMailOperations.createLabel, "labels.changed")
    ),
  deleteDraft: protectedProcedure
    .input(mailInputSchemas.deleteDraft)
    .handler(
      withMailUpdate(
        composeMailOperations.deleteDraft,
        "mailbox.changed",
        managedMessageChanges
      )
    ),
  deleteLabel: protectedProcedure
    .input(mailInputSchemas.deleteLabel)
    .handler(
      withMailUpdate(labelsMailOperations.deleteLabel, "labels.changed")
    ),
  getAttachment: protectedProcedure
    .route({ method: "GET" })
    .input(mailInputSchemas.getAttachment)
    .handler(queriesMailOperations.getAttachment),
  getComposeSendStatus: protectedProcedure
    .route({ method: "GET" })
    .input(mailInputSchemas.getComposeSendStatus)
    .handler(composeMailOperations.getComposeSendStatus),
  getDraft: protectedProcedure
    .route({ method: "GET" })
    .input(mailInputSchemas.getDraft)
    .handler(queriesMailOperations.getDraft),
  getHeldSend: protectedProcedure
    .route({ method: "GET" })
    .input(mailInputSchemas.getComposeSendStatus)
    .handler(
      async ({ context, input }) =>
        await getHeldSend({ ...input, userId: context.userId })
    ),
  getLabelOrganization: protectedProcedure
    .input(mailInputSchemas.listLabels)
    .handler(async ({ context, input }) => {
      context.resHeaders?.set("Cache-Control", "private, no-store");
      return await getLabelOrganization({ ...input, userId: context.userId });
    }),
  getMailCaptureStatus: protectedProcedure
    .route({ method: "GET" })
    .input(mailInputSchemas.getMailCaptureStatus)
    .handler(
      async ({ context, input }) =>
        await getMailCaptureStatus({ ...input, userId: context.userId })
    ),
  getMessageDelivery: protectedProcedure
    .route({ method: "GET" })
    .input(mailInputSchemas.getMessageDelivery)
    .handler(queriesMailOperations.getMessageDelivery),
  getMessageInspector: protectedProcedure
    .route({ method: "GET" })
    .input(mailInputSchemas.getMessageInspector)
    .handler(queriesMailOperations.getMessageInspector),
  getThread: protectedProcedure
    .route({ method: "GET" })
    .input(mailInputSchemas.getThread)
    .handler(queriesMailOperations.getThread),
  listLabelSuggestions: protectedProcedure
    .input(
      mailInputSchemas.listLabels.extend({
        messageIds: z.array(z.string().trim().min(1).max(512)).min(1).max(100),
      })
    )
    .handler(async ({ context, input }) => {
      context.resHeaders?.set("Cache-Control", "private, no-store");
      return await listLabelSuggestions({ ...input, userId: context.userId });
    }),
  listLabels: protectedProcedure
    .route({ method: "GET" })
    .input(mailInputSchemas.listLabels)
    .handler(labelsMailOperations.listLabels),
  listMailboxRowIds: protectedProcedure
    .route({ method: "GET" })
    .input(mailInputSchemas.listMailboxRowIds)
    .handler(queriesMailOperations.listMailboxRowIds),
  listMessageDeliveryStatuses: protectedProcedure
    .route({ method: "GET" })
    .input(mailInputSchemas.listMessageDeliveryStatuses)
    .handler(queriesMailOperations.listMessageDeliveryStatuses),
  listRecipientSuggestions: protectedProcedure
    .input(mailInputSchemas.listRecipientSuggestions)
    .handler(async ({ context, input }) => {
      context.resHeaders?.set("Cache-Control", "private, no-store");
      return await listRecipientSuggestions({ context, input });
    }),
  listThreads: protectedProcedure
    .route({ method: "GET" })
    .input(mailInputSchemas.listThreads)
    .handler(queriesMailOperations.listThreads),
  markMessageAsRead: protectedProcedure
    .input(mailInputSchemas.markMessageAsRead)
    .handler(
      withMailUpdate(
        mutationsMailOperations.markMessageAsRead,
        "mailbox.changed",
        journaledMessageChanges
      )
    ),
  markMessageAsUnread: protectedProcedure
    .input(mailInputSchemas.markMessageAsUnread)
    .handler(
      withMailUpdate(
        mutationsMailOperations.markMessageAsUnread,
        "mailbox.changed",
        journaledMessageChanges
      )
    ),
  markThreadAsRead: protectedProcedure
    .input(mailInputSchemas.markThreadAsRead)
    .handler(
      withMailUpdate(
        mutationsMailOperations.markThreadAsRead,
        "mailbox.changed",
        journaledMessageChanges
      )
    ),
  markThreadAsUnread: protectedProcedure
    .input(mailInputSchemas.markThreadAsUnread)
    .handler(
      withMailUpdate(
        mutationsMailOperations.markThreadAsUnread,
        "mailbox.changed",
        journaledMessageChanges
      )
    ),
  moveMessageToTrash: protectedProcedure
    .input(mailInputSchemas.moveMessageToTrash)
    .handler(
      withMailUpdate(
        mutationsMailOperations.moveMessageToTrash,
        "mailbox.changed",
        journaledMessageChanges
      )
    ),
  moveThreadToTrash: protectedProcedure
    .input(mailInputSchemas.moveThreadToTrash)
    .handler(
      withMailUpdate(
        mutationsMailOperations.moveThreadToTrash,
        "mailbox.changed",
        journaledMessageChanges
      )
    ),
  previewUnsubscribe: protectedProcedure
    .input(
      mailInputSchemas.unsubscribeFromMessage.omit({
        expectedRequestHash: true,
      })
    )
    .handler(composeMailOperations.previewUnsubscribe),
  pullMailboxChanges: protectedProcedure
    .input(
      mailInputSchemas.syncMailbox.pick({ mailboxId: true }).extend({
        windows: z
          .array(mailInputSchemas.syncMailbox.omit({ mailboxId: true }))
          .min(1)
          .max(7),
      })
    )
    .handler(
      async ({ context, input }) =>
        await Promise.all(
          input.windows.map(
            async (window) =>
              await queriesMailOperations.syncMailbox({
                context,
                input: { ...window, mailboxId: input.mailboxId },
              })
          )
        )
    ),
  saveDraft: protectedProcedure
    .input(mailInputSchemas.saveDraft)
    .handler(
      withMailUpdate(
        composeMailOperations.saveDraft,
        "mailbox.changed",
        managedMessageChanges
      )
    ),
  sendDraft: protectedProcedure.input(mailInputSchemas.sendDraft).handler(
    async ({ context, input }) =>
      await dispatchOrdinaryMail({
        context,
        mailboxId: input.mailboxId,
        message: input.draft,
      })
  ),
  sendMessage: protectedProcedure.input(mailInputSchemas.sendMessage).handler(
    async ({ context, input }) =>
      await dispatchOrdinaryMail({
        context,
        mailboxId: input.mailboxId,
        message: input.message,
      })
  ),
  syncMailbox: protectedProcedure
    .route({ method: "GET" })
    .input(mailInputSchemas.syncMailbox)
    .handler(queriesMailOperations.syncMailbox),
  undoSend: protectedProcedure
    .input(mailInputSchemas.getComposeSendStatus)
    .handler(
      async ({ context, input }) =>
        await undoHeldSend({ ...input, userId: context.userId })
    ),
  unsubscribeFromMessage: protectedProcedure
    .input(mailInputSchemas.unsubscribeFromMessage)
    .handler(withMailUpdate(composeMailOperations.unsubscribeFromMessage)),
  untrashMessage: protectedProcedure
    .input(mailInputSchemas.untrashMessage)
    .handler(
      withMailUpdate(
        mutationsMailOperations.untrashMessage,
        "mailbox.changed",
        journaledMessageChanges
      )
    ),
  untrashThread: protectedProcedure
    .input(mailInputSchemas.untrashThread)
    .handler(
      withMailUpdate(
        mutationsMailOperations.untrashThread,
        "mailbox.changed",
        journaledMessageChanges
      )
    ),
  updateLabel: protectedProcedure
    .input(mailInputSchemas.updateLabel)
    .handler(
      withMailUpdate(labelsMailOperations.updateLabel, "labels.changed")
    ),
  updateLabelDetails: protectedProcedure
    .input(mailInputSchemas.updateLabelDetails)
    .handler(
      withMailUpdate(labelsMailOperations.updateLabelDetails, "labels.changed")
    ),
  updateLabelOrganization: protectedProcedure
    .input(
      mailInputSchemas.listLabels.extend({
        action: labelOrganizationActionSchema,
      })
    )
    .handler(
      withMailUpdate(
        async ({ context, input }) =>
          await updateLabelOrganization(
            { mailboxId: input.mailboxId, userId: context.userId },
            input.action
          ),
        "labels.changed"
      )
    ),
  updateMessageLabels: protectedProcedure
    .input(mailInputSchemas.updateMessageLabels)
    .handler(
      withMailUpdate(
        mutationsMailOperations.updateMessageLabels,
        "mailbox.changed",
        journaledMessageChanges
      )
    ),
  updateThreadLabels: protectedProcedure
    .input(mailInputSchemas.updateThreadLabels)
    .handler(
      withMailUpdate(
        mutationsMailOperations.updateThreadLabels,
        "mailbox.changed",
        journaledMessageChanges
      )
    ),
};
