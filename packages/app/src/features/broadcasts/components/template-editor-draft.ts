import { createEmailDesign } from "@quieter/mail/email-design";
import type { EmailTemplate } from "@quieter/mail/templates";

type TemplateFields = Pick<EmailTemplate, "content" | "name" | "subject">;

export type TemplateEditorDraft = TemplateFields & {
  received: EmailTemplate | undefined;
  saved: EmailTemplate | undefined;
};

type TemplateEditorEvent =
  | { fields: Partial<TemplateFields>; kind: "edit" }
  | { kind: "received"; saving: boolean; template: EmailTemplate }
  | { kind: "saved"; template: EmailTemplate }
  | { kind: "reload"; template: EmailTemplate };

export const createTemplateEditorDraft = (
  template: EmailTemplate | undefined
): TemplateEditorDraft => ({
  content: template?.content ?? { design: createEmailDesign(), kind: "visual" },
  name: template?.name ?? "Untitled template",
  received: template,
  saved: template,
  subject: template?.subject ?? "",
});

export const templateEditorDraftReducer = (
  state: TemplateEditorDraft,
  event: TemplateEditorEvent
): TemplateEditorDraft => {
  if (event.kind === "saved" || event.kind === "reload") {
    const newest =
      state.received &&
      Date.parse(state.received.updatedAt) >
        Date.parse(event.template.updatedAt)
        ? state.received
        : event.template;
    return createTemplateEditorDraft(newest);
  }

  let next = state;
  if (event.kind === "edit") {
    next = { ...state, ...event.fields };
  } else {
    if (
      state.received &&
      Date.parse(state.received.updatedAt) >=
        Date.parse(event.template.updatedAt)
    ) {
      return state;
    }
    next = { ...state, received: event.template };
    if (event.saving) {
      return next;
    }
  }

  const { saved, received } = next;
  if (
    saved &&
    received &&
    next.name === saved.name &&
    next.subject === saved.subject &&
    JSON.stringify(next.content) === JSON.stringify(saved.content) &&
    Date.parse(received.updatedAt) > Date.parse(saved.updatedAt)
  ) {
    return createTemplateEditorDraft(received);
  }
  return next;
};
