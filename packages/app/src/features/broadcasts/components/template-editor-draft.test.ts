import type { EmailTemplate } from "@quieter/mail/templates";
import { describe, expect, test } from "vite-plus/test";

import {
  createTemplateEditorDraft,
  templateEditorDraftReducer,
} from "./template-editor-draft";

const original: EmailTemplate = {
  archivedAt: null,
  content: { kind: "text", text: "Welcome, Avery." },
  createdAt: "2026-11-02T10:00:00.000Z",
  id: "template-one",
  name: "Welcome",
  organizationId: "team-one",
  subject: "Your account is ready",
  updatedAt: "2026-11-02T10:00:00.000Z",
};

const incoming: EmailTemplate = {
  ...original,
  content: { kind: "text", text: "Your updated welcome email." },
  name: "A new welcome",
  subject: "Welcome aboard",
  updatedAt: "2026-11-02T10:01:00.000Z",
};

describe("template editor synchronization", () => {
  test("refreshes clean fields and ignores an older response", () => {
    const updated = templateEditorDraftReducer(
      createTemplateEditorDraft(original),
      { kind: "received", saving: false, template: incoming }
    );
    const lateResponse = templateEditorDraftReducer(updated, {
      kind: "received",
      saving: false,
      template: original,
    });
    expect(lateResponse).toMatchObject({
      content: { text: "Your updated welcome email." },
      name: "A new welcome",
      saved: { updatedAt: incoming.updatedAt },
      subject: "Welcome aboard",
    });
  });

  test("keeps unsaved fields and their accepted version until explicit reload", () => {
    const edited = templateEditorDraftReducer(
      createTemplateEditorDraft(original),
      {
        fields: {
          content: { kind: "text", text: "My unsaved email." },
          name: "My draft",
          subject: "My draft subject",
        },
        kind: "edit",
      }
    );
    const conflicted = templateEditorDraftReducer(edited, {
      kind: "received",
      saving: false,
      template: incoming,
    });
    expect(conflicted).toMatchObject({
      content: { text: "My unsaved email." },
      name: "My draft",
      received: { updatedAt: incoming.updatedAt },
      saved: { updatedAt: original.updatedAt },
      subject: "My draft subject",
    });
    const reloaded = templateEditorDraftReducer(conflicted, {
      kind: "reload",
      template: incoming,
    });
    expect(reloaded).toMatchObject({
      content: { text: "Your updated welcome email." },
      name: "A new welcome",
      saved: { updatedAt: incoming.updatedAt },
    });
  });

  test("keeps the completed save when a stale poll arrives afterward", () => {
    const saved: EmailTemplate = {
      ...original,
      name: "My saved draft",
      updatedAt: "2026-11-02T10:02:00.000Z",
    };
    const edited = templateEditorDraftReducer(
      createTemplateEditorDraft(original),
      { fields: { name: "My saved draft" }, kind: "edit" }
    );
    const polled = templateEditorDraftReducer(edited, {
      kind: "received",
      saving: true,
      template: incoming,
    });
    const completed = templateEditorDraftReducer(polled, {
      kind: "saved",
      template: saved,
    });
    const stale = templateEditorDraftReducer(completed, {
      kind: "received",
      saving: false,
      template: incoming,
    });
    expect(stale).toMatchObject({
      name: "My saved draft",
      saved: { updatedAt: saved.updatedAt },
    });
  });

  test("shows a newer external save even when its poll precedes our save response", () => {
    const ownSave: EmailTemplate = {
      ...original,
      name: "Saved in this browser",
      updatedAt: "2026-11-02T10:02:00.000Z",
    };
    const newer: EmailTemplate = {
      ...incoming,
      name: "Latest local code",
      updatedAt: "2026-11-02T10:03:00.000Z",
    };
    const edited = templateEditorDraftReducer(
      createTemplateEditorDraft(original),
      { fields: { name: "Saved in this browser" }, kind: "edit" }
    );
    const received = templateEditorDraftReducer(edited, {
      kind: "received",
      saving: true,
      template: newer,
    });
    const completed = templateEditorDraftReducer(received, {
      kind: "saved",
      template: ownSave,
    });
    expect(completed).toMatchObject({
      name: "Latest local code",
      saved: { updatedAt: newer.updatedAt },
    });
  });

  test("adopts incoming content once the user removes all unsaved changes", () => {
    const edited = templateEditorDraftReducer(
      createTemplateEditorDraft(original),
      { fields: { name: "Temporary edit" }, kind: "edit" }
    );
    const received = templateEditorDraftReducer(edited, {
      kind: "received",
      saving: false,
      template: incoming,
    });
    const restored = templateEditorDraftReducer(received, {
      fields: { name: "Welcome" },
      kind: "edit",
    });
    expect(restored).toMatchObject({
      content: { text: "Your updated welcome email." },
      name: "A new welcome",
      saved: { updatedAt: incoming.updatedAt },
    });
  });
});
