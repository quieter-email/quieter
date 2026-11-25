import type { db } from "@quieter/database/client";
import { user } from "@quieter/database/schema";
import { mailSnoozeApplySchema } from "@quieter/mail/snooze";
import { eq } from "drizzle-orm";

import { getMailCaptureStatus } from "../mail-capture";
import { publishMailUpdate, withMailUpdate } from "../mail-updates";
import { composeMailOperations } from "../mail/compose";
import { mailInputSchemas } from "../mail/inputs";
import type { MailInputs } from "../mail/inputs";
import { labelsMailOperations } from "../mail/labels";
import { mutationsMailOperations } from "../mail/mutations";
import { queriesMailOperations } from "../mail/queries";
import {
  createHeldSend,
  getHeldSend,
  undoHeldSend,
} from "../scheduled-send/service";
import { applyMailSnooze } from "../snooze/service";
import { protectedProcedure } from "./base";
import { mailboxProcedures } from "./mail/mailboxes";
import { managedOrganizationMailRouter } from "./mail/managed-organization";

const gmailMessageChanges = { trackedByGmail: true };

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
    const sent = await composeMailOperations.sendMessage({
      context,
      input: { mailboxId, message },
    });
    await publishMailUpdate({ mailboxId, type: "mailbox.changed" });
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
    })
  ),
  applySnooze: protectedProcedure
    .input(mailSnoozeApplySchema)
    .handler(withMailUpdate(applyMailSnooze)),
  createLabel: protectedProcedure
    .input(mailInputSchemas.createLabel)
    .handler(
      withMailUpdate(labelsMailOperations.createLabel, "labels.changed")
    ),
  deleteDraft: protectedProcedure
    .input(mailInputSchemas.deleteDraft)
    .handler(withMailUpdate(composeMailOperations.deleteDraft)),
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
  listLabels: protectedProcedure
    .route({ method: "GET" })
    .input(mailInputSchemas.listLabels)
    .handler(labelsMailOperations.listLabels),
  listMessageDeliveryStatuses: protectedProcedure
    .route({ method: "GET" })
    .input(mailInputSchemas.listMessageDeliveryStatuses)
    .handler(queriesMailOperations.listMessageDeliveryStatuses),
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
        gmailMessageChanges
      )
    ),
  markMessageAsUnread: protectedProcedure
    .input(mailInputSchemas.markMessageAsUnread)
    .handler(
      withMailUpdate(
        mutationsMailOperations.markMessageAsUnread,
        "mailbox.changed",
        gmailMessageChanges
      )
    ),
  markThreadAsRead: protectedProcedure
    .input(mailInputSchemas.markThreadAsRead)
    .handler(
      withMailUpdate(
        mutationsMailOperations.markThreadAsRead,
        "mailbox.changed",
        gmailMessageChanges
      )
    ),
  markThreadAsUnread: protectedProcedure
    .input(mailInputSchemas.markThreadAsUnread)
    .handler(
      withMailUpdate(
        mutationsMailOperations.markThreadAsUnread,
        "mailbox.changed",
        gmailMessageChanges
      )
    ),
  moveMessageToTrash: protectedProcedure
    .input(mailInputSchemas.moveMessageToTrash)
    .handler(
      withMailUpdate(
        mutationsMailOperations.moveMessageToTrash,
        "mailbox.changed",
        gmailMessageChanges
      )
    ),
  moveThreadToTrash: protectedProcedure
    .input(mailInputSchemas.moveThreadToTrash)
    .handler(
      withMailUpdate(
        mutationsMailOperations.moveThreadToTrash,
        "mailbox.changed",
        gmailMessageChanges
      )
    ),
  previewUnsubscribe: protectedProcedure
    .input(
      mailInputSchemas.unsubscribeFromMessage.omit({
        expectedRequestHash: true,
      })
    )
    .handler(composeMailOperations.previewUnsubscribe),
  saveDraft: protectedProcedure
    .input(mailInputSchemas.saveDraft)
    .handler(withMailUpdate(composeMailOperations.saveDraft)),
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
        gmailMessageChanges
      )
    ),
  untrashThread: protectedProcedure
    .input(mailInputSchemas.untrashThread)
    .handler(
      withMailUpdate(
        mutationsMailOperations.untrashThread,
        "mailbox.changed",
        gmailMessageChanges
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
  updateMessageLabels: protectedProcedure
    .input(mailInputSchemas.updateMessageLabels)
    .handler(
      withMailUpdate(
        mutationsMailOperations.updateMessageLabels,
        "mailbox.changed",
        gmailMessageChanges
      )
    ),
  updateThreadLabels: protectedProcedure
    .input(mailInputSchemas.updateThreadLabels)
    .handler(
      withMailUpdate(
        mutationsMailOperations.updateThreadLabels,
        "mailbox.changed",
        gmailMessageChanges
      )
    ),
};
