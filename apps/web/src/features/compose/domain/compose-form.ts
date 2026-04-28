import { composeDraftFormValuesSchema } from "@quieter/orpc/compose";
import { z } from "zod";
import {
  haveComposeDraftPersistedFieldsChanged,
  hasComposeDraftContent,
  getRenderableComposeBodyHtml,
  removeComposeRuntimeFile,
  syncInlineImagesWithHtml,
  type ComposeDraftState,
} from "./draft";

export type ComposeFormValues = z.infer<typeof composeDraftFormValuesSchema>;

export const emptyComposeFormValues: ComposeFormValues = {
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  bodyHtml: "",
  bodyText: "",
};

type ComposeFormWriter = {
  reset: (values: ComposeFormValues) => void;
  setFieldValue: {
    (field: "to", value: string): void;
    (field: "cc", value: string): void;
    (field: "bcc", value: string): void;
    (field: "subject", value: string): void;
    (field: "bodyHtml", value: string): void;
    (field: "bodyText", value: string): void;
  };
  validateAllFields: (cause: "change") => unknown;
};

type ComposeDraftFormMeta = Pick<
  ComposeDraftState,
  | "localId"
  | "draftId"
  | "messageId"
  | "draftAnchor"
  | "replyContext"
  | "attachments"
  | "inlineImages"
  | "saveStatus"
  | "errorMessage"
  | "lastSavedAt"
  | "updatedAt"
>;

export const draftToComposeFormValues = (draft: ComposeDraftState): ComposeFormValues => ({
  to: draft.recipients.to,
  cc: draft.recipients.cc,
  bcc: draft.recipients.bcc,
  subject: draft.subject,
  bodyHtml: getRenderableComposeBodyHtml(draft.bodyHtml, draft.bodyText),
  bodyText: draft.bodyText,
});

export const writeComposeFormValues = (form: ComposeFormWriter, values: ComposeFormValues) => {
  form.reset(values);
  form.setFieldValue("to", values.to);
  form.setFieldValue("cc", values.cc);
  form.setFieldValue("bcc", values.bcc);
  form.setFieldValue("subject", values.subject);
  form.setFieldValue("bodyHtml", values.bodyHtml);
  form.setFieldValue("bodyText", values.bodyText);

  void form.validateAllFields("change");
};

export const composeFormValuesToDraft = (
  values: ComposeFormValues,
  meta: ComposeDraftFormMeta,
): ComposeDraftState => {
  const base = {
    ...meta,
    recipients: { to: values.to, cc: values.cc, bcc: values.bcc },
    subject: values.subject,
    bodyHtml: values.bodyHtml,
    bodyText: values.bodyText,
  };
  const previousInlineImageIds = new Set(meta.inlineImages.map((image) => image.id));
  const syncedDraft = syncInlineImagesWithHtml(base, values.bodyHtml);
  const nextInlineImageIds = new Set(syncedDraft.inlineImages.map((image) => image.id));

  for (const id of previousInlineImageIds) {
    if (!nextInlineImageIds.has(id)) {
      removeComposeRuntimeFile(id);
    }
  }

  return syncedDraft;
};

export const canSaveComposeFormValues = (values: ComposeFormValues) =>
  composeDraftFormValuesSchema.safeParse(values).success;

export const shouldPersistComposeDraft = ({
  currentDraft,
  nextDraft,
  values,
}: {
  currentDraft: ComposeDraftState;
  nextDraft: ComposeDraftState;
  values: ComposeFormValues;
}) =>
  canSaveComposeFormValues(values) &&
  hasComposeDraftContent(nextDraft) &&
  (currentDraft.saveStatus === "error" ||
    !nextDraft.draftId ||
    haveComposeDraftPersistedFieldsChanged(currentDraft, nextDraft));
