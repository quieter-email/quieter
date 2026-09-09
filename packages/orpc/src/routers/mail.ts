import { composeMailOperations } from "../mail/compose";
import { mailInputSchemas } from "../mail/inputs";
import { labelsMailOperations } from "../mail/labels";
import { mutationsMailOperations } from "../mail/mutations";
import { queriesMailOperations } from "../mail/queries";
import { protectedProcedure } from "./base";
import { mailboxProcedures } from "./mail/mailboxes";
import { managedOrganizationMailRouter } from "./mail/managed-organization";
import { mailboxSavedViewRouter } from "./mail/saved-views";
import { mailSyncRouter } from "./mail/sync";

export const mailRouter = {
  ...mailSyncRouter,
  ...mailboxProcedures,
  ...mailboxSavedViewRouter,
  ...managedOrganizationMailRouter,
  applyChanges: protectedProcedure
    .input(mailInputSchemas.applyChanges)
    .handler(mutationsMailOperations.applyChanges),
  createLabel: protectedProcedure
    .input(mailInputSchemas.createLabel)
    .handler(labelsMailOperations.createLabel),
  deleteDraft: protectedProcedure
    .input(mailInputSchemas.deleteDraft)
    .handler(composeMailOperations.deleteDraft),
  deleteLabel: protectedProcedure
    .input(mailInputSchemas.deleteLabel)
    .handler(labelsMailOperations.deleteLabel),
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
    .handler(mutationsMailOperations.markMessageAsRead),
  markMessageAsUnread: protectedProcedure
    .input(mailInputSchemas.markMessageAsUnread)
    .handler(mutationsMailOperations.markMessageAsUnread),
  markThreadAsRead: protectedProcedure
    .input(mailInputSchemas.markThreadAsRead)
    .handler(mutationsMailOperations.markThreadAsRead),
  markThreadAsUnread: protectedProcedure
    .input(mailInputSchemas.markThreadAsUnread)
    .handler(mutationsMailOperations.markThreadAsUnread),
  moveMessageToTrash: protectedProcedure
    .input(mailInputSchemas.moveMessageToTrash)
    .handler(mutationsMailOperations.moveMessageToTrash),
  moveThreadToTrash: protectedProcedure
    .input(mailInputSchemas.moveThreadToTrash)
    .handler(mutationsMailOperations.moveThreadToTrash),
  saveDraft: protectedProcedure
    .input(mailInputSchemas.saveDraft)
    .handler(composeMailOperations.saveDraft),
  sendDraft: protectedProcedure
    .input(mailInputSchemas.sendDraft)
    .handler(composeMailOperations.sendDraft),
  sendMessage: protectedProcedure
    .input(mailInputSchemas.sendMessage)
    .handler(composeMailOperations.sendMessage),
  syncMailbox: protectedProcedure
    .route({ method: "GET" })
    .input(mailInputSchemas.syncMailbox)
    .handler(queriesMailOperations.syncMailbox),
  unsubscribeFromMessage: protectedProcedure
    .input(mailInputSchemas.unsubscribeFromMessage)
    .handler(composeMailOperations.unsubscribeFromMessage),
  untrashMessage: protectedProcedure
    .input(mailInputSchemas.untrashMessage)
    .handler(mutationsMailOperations.untrashMessage),
  untrashThread: protectedProcedure
    .input(mailInputSchemas.untrashThread)
    .handler(mutationsMailOperations.untrashThread),
  updateLabel: protectedProcedure
    .input(mailInputSchemas.updateLabel)
    .handler(labelsMailOperations.updateLabel),
  updateLabelDetails: protectedProcedure
    .input(mailInputSchemas.updateLabelDetails)
    .handler(labelsMailOperations.updateLabelDetails),
  updateMessageLabels: protectedProcedure
    .input(mailInputSchemas.updateMessageLabels)
    .handler(mutationsMailOperations.updateMessageLabels),
  updateThreadLabels: protectedProcedure
    .input(mailInputSchemas.updateThreadLabels)
    .handler(mutationsMailOperations.updateThreadLabels),
};
