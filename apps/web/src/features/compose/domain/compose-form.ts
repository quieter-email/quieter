import { composeDraftFormValuesSchema } from "@quieter/mail/compose/schema";
import type { z } from "zod";

import {
  haveComposeDraftPersistedFieldsChanged,
  hasComposeDraftContent,
  getRenderableComposeBodyHtml,
  removeComposeRuntimeFile,
  syncInlineImagesWithHtml,
} from "./draft";
import type { ComposeDraftState } from "./draft";

export type ComposeFormValues = z.infer<typeof composeDraftFormValuesSchema>;

export const emptyComposeFormValues: ComposeFormValues = {
  bcc: "",
  bodyHtml: "",
  bodyText: "",
  cc: "",
  subject: "",
  to: "",
};

type ComposeFormWriter = {
  reset: (values: ComposeFormValues) => void;
  setFieldValue: (
    field: "bcc" | "bodyHtml" | "bodyText" | "cc" | "subject" | "to",
    value: string
  ) => void;
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

export const draftToComposeFormValues = (
  draft: ComposeDraftState
): ComposeFormValues => ({
  bcc: draft.recipients.bcc,
  bodyHtml: getRenderableComposeBodyHtml(draft.bodyHtml, draft.bodyText),
  bodyText: draft.bodyText,
  cc: draft.recipients.cc,
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
    subject: values.subject,
  };
  const previousInlineImageIds = new Set(
    meta.inlineImages.map((image) => image.id)
  );
  const syncedDraft = syncInlineImagesWithHtml(base, values.bodyHtml);
  const nextInlineImageIds = new Set(
    syncedDraft.inlineImages.map((image) => image.id)
  );

  for (const id of previousInlineImageIds) {
    if (!nextInlineImageIds.has(id)) {
      removeComposeRuntimeFile(id);
    }
  }

  return syncedDraft;
};

export const shouldPersistComposeDraft = ({
  currentDraft,
  nextDraft,
  values,
}: {
  currentDraft: ComposeDraftState;
  nextDraft: ComposeDraftState;
  values: ComposeFormValues;
}) =>
  composeDraftFormValuesSchema.safeParse(values).success &&
  hasComposeDraftContent(nextDraft) &&
  (currentDraft.saveStatus === "error" ||
    haveComposeDraftPersistedFieldsChanged(currentDraft, nextDraft));
