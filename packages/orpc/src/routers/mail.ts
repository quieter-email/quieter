import { composeMailOperations } from "../mail/compose";
import { mailInputSchemas } from "../mail/inputs";
import { labelsMailOperations } from "../mail/labels";
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
  saveDraft: protectedProcedure
    .input(mailInputSchemas.saveDraft)
    .handler(composeMailOperations.saveDraft),
  sendDraft: protectedProcedure
    .input(mailInputSchemas.sendDraft)
    .handler(composeMailOperations.sendDraft),
  sendMessage: protectedProcedure
    .input(mailInputSchemas.sendMessage)
    .handler(composeMailOperations.sendMessage),
  unsubscribeFromMessage: protectedProcedure
    .input(mailInputSchemas.unsubscribeFromMessage)
    .handler(composeMailOperations.unsubscribeFromMessage),
  updateLabel: protectedProcedure
    .input(mailInputSchemas.updateLabel)
    .handler(labelsMailOperations.updateLabel),
  updateLabelDetails: protectedProcedure
    .input(mailInputSchemas.updateLabelDetails)
    .handler(labelsMailOperations.updateLabelDetails),
};
