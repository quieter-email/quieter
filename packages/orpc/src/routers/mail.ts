import { withMailUpdate } from "../mail-updates";
import { composeMailOperations } from "../mail/compose";
import { mailInputSchemas } from "../mail/inputs";
import { labelsMailOperations } from "../mail/labels";
import { mutationsMailOperations } from "../mail/mutations";
import { queriesMailOperations } from "../mail/queries";
import { protectedProcedure } from "./base";
import { mailboxProcedures } from "./mail/mailboxes";
import { managedOrganizationMailRouter } from "./mail/managed-organization";

export const mailRouter = {
  ...mailboxProcedures,
  ...managedOrganizationMailRouter,
  applyChanges: protectedProcedure
    .input(mailInputSchemas.applyChanges)
    .handler(withMailUpdate(mutationsMailOperations.applyChanges)),
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
    .handler(withMailUpdate(mutationsMailOperations.markMessageAsRead)),
  markMessageAsUnread: protectedProcedure
    .input(mailInputSchemas.markMessageAsUnread)
    .handler(withMailUpdate(mutationsMailOperations.markMessageAsUnread)),
  markThreadAsRead: protectedProcedure
    .input(mailInputSchemas.markThreadAsRead)
    .handler(withMailUpdate(mutationsMailOperations.markThreadAsRead)),
  markThreadAsUnread: protectedProcedure
    .input(mailInputSchemas.markThreadAsUnread)
    .handler(withMailUpdate(mutationsMailOperations.markThreadAsUnread)),
  moveMessageToTrash: protectedProcedure
    .input(mailInputSchemas.moveMessageToTrash)
    .handler(withMailUpdate(mutationsMailOperations.moveMessageToTrash)),
  moveThreadToTrash: protectedProcedure
    .input(mailInputSchemas.moveThreadToTrash)
    .handler(withMailUpdate(mutationsMailOperations.moveThreadToTrash)),
  saveDraft: protectedProcedure
    .input(mailInputSchemas.saveDraft)
    .handler(withMailUpdate(composeMailOperations.saveDraft)),
  sendDraft: protectedProcedure
    .input(mailInputSchemas.sendDraft)
    .handler(withMailUpdate(composeMailOperations.sendDraft)),
  sendMessage: protectedProcedure
    .input(mailInputSchemas.sendMessage)
    .handler(withMailUpdate(composeMailOperations.sendMessage)),
  syncMailbox: protectedProcedure
    .route({ method: "GET" })
    .input(mailInputSchemas.syncMailbox)
    .handler(queriesMailOperations.syncMailbox),
  unsubscribeFromMessage: protectedProcedure
    .input(mailInputSchemas.unsubscribeFromMessage)
    .handler(withMailUpdate(composeMailOperations.unsubscribeFromMessage)),
  untrashMessage: protectedProcedure
    .input(mailInputSchemas.untrashMessage)
    .handler(withMailUpdate(mutationsMailOperations.untrashMessage)),
  untrashThread: protectedProcedure
    .input(mailInputSchemas.untrashThread)
    .handler(withMailUpdate(mutationsMailOperations.untrashThread)),
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
    .handler(withMailUpdate(mutationsMailOperations.updateMessageLabels)),
  updateThreadLabels: protectedProcedure
    .input(mailInputSchemas.updateThreadLabels)
    .handler(withMailUpdate(mutationsMailOperations.updateThreadLabels)),
};
