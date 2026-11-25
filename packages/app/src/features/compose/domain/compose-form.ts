import {
  haveComposeDraftPersistedFieldsChanged,
  getRenderableComposeBodyHtml,
  syncInlineImagesWithHtml,
} from "@quieter/app/features/compose/domain/draft";
import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import type { composeDraftFormValuesSchema } from "@quieter/mail/compose/schema";
import type { z } from "zod";

export type ComposeFormValues = z.infer<typeof composeDraftFormValuesSchema>;

type ComposeFormWriter = {
  reset: (values: ComposeFormValues) => void;
  setFieldValue: (field: keyof ComposeFormValues, value: string) => void;
  validateAllFields: (cause: "change") => unknown;
};

type ComposeDraftFormMeta = Pick<
  ComposeDraftState,
  | "assistantUnsaved"
  | "followUpReminder"
  | "localId"
  | "baseRevision"
  | "draftId"
  | "messageId"
  | "draftAnchor"
  | "replyContext"
  | "attachments"
  | "inlineImages"
  | "saveStatus"
  | "sendOperationId"
  | "sendUncertain"
  | "scheduleAttempt"
  | "holdAttempt"
  | "heldDraftHasNewerEdits"
  | "errorMessage"
  | "lastSavedAt"
  | "recoveryEditorId"
  | "recoveryLocalId"
  | "recoveryMissingFiles"
  | "recoveryUpdatedAt"
  | "recoveryRevision"
  | "updatedAt"
>;

export const draftToComposeFormValues = (
  draft: ComposeDraftState
): ComposeFormValues => ({
  bcc: draft.recipients.bcc,
  bodyHtml: getRenderableComposeBodyHtml(draft.bodyHtml, draft.bodyText),
  bodyText: draft.bodyText,
  cc: draft.recipients.cc,
  senderName: draft.senderName ?? "",
  subject: draft.subject,
  to: draft.recipients.to,
});

export const writeComposeFormValues = (
  form: ComposeFormWriter,
  values: ComposeFormValues
) => {
  form.reset(values);
  form.setFieldValue("to", values.to);
  form.setFieldValue("cc", values.cc);
  form.setFieldValue("bcc", values.bcc);
  form.setFieldValue("subject", values.subject);
  form.setFieldValue("senderName", values.senderName);
  form.setFieldValue("bodyHtml", values.bodyHtml);
  form.setFieldValue("bodyText", values.bodyText);

  void form.validateAllFields("change");
};

export const composeFormValuesToDraft = (
  values: ComposeFormValues,
  meta: ComposeDraftFormMeta
): ComposeDraftState => {
  const base = {
    ...meta,
    bodyHtml: values.bodyHtml,
    bodyText: values.bodyText,
    recipients: { bcc: values.bcc, cc: values.cc, to: values.to },
    senderName: values.senderName,
    subject: values.subject,
  };
  const syncedDraft = syncInlineImagesWithHtml(base, values.bodyHtml);
  return { ...syncedDraft, bodyText: values.bodyText };
};

export const shouldPersistComposeDraft = ({
  currentDraft,
  nextDraft,
}: {
  currentDraft: ComposeDraftState;
  nextDraft: ComposeDraftState;
}) =>
  (!currentDraft.draftId && currentDraft.lastSavedAt === undefined) ||
  currentDraft.saveStatus === "error" ||
  haveComposeDraftPersistedFieldsChanged(currentDraft, nextDraft);
