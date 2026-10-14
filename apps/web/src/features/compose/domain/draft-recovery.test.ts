import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { draftRecoveryJournal } from "#/lib/draft-recovery-journal";

import {
  findRecoverableComposeDraft,
  restoreComposeDraft,
} from "./draft-recovery";

const draft = {
  attachments: [],
  bodyHtml: "<p>Unfinished text</p>",
  bodyText: "Unfinished text",
  errorMessage: null,
  inlineImages: [],
  localId: "local",
  recipients: { bcc: "", cc: "", to: "unfinished@" },
  saveStatus: "idle",
  subject: "Work",
  updatedAt: 1,
};

describe("compose recovery", () => {
  it("preserves incomplete recipients without validating a send", () => {
    expect(
      restoreComposeDraft(JSON.stringify(draft), "editor", 42)
    ).toMatchObject({
      bodyText: draft.bodyText,
      recipients: { to: "unfinished@" },
      recoveryEditorId: "editor",
      recoveryUpdatedAt: 42,
    });
  });

  it("keeps remote attachments and asks for missing local files", () => {
    const recovered = restoreComposeDraft(
      JSON.stringify({
        ...draft,
        attachments: [
          {
            id: "local",
            isInline: false,
            mimeType: "text/plain",
            name: "notes.txt",
            size: 1,
          },
          {
            gmailAttachmentId: "saved",
            id: "remote",
            isInline: false,
            mimeType: "text/plain",
            name: "saved.txt",
            size: 1,
          },
        ],
        bodyHtml: '<p>Text</p><img src="blob:lost">',
      }),
      "editor"
    );
    expect(recovered.attachments).toHaveLength(1);
    expect(recovered.bodyHtml).toBe("<p>Text</p>");
    expect(recovered.errorMessage).toContain("notes.txt");
  });

  it("does not silently retry a send interrupted by closing the tab", () => {
    const recovered = restoreComposeDraft(
      JSON.stringify({ ...draft, saveStatus: "sending" }),
      "editor"
    );
    expect(recovered.saveStatus).toBe("error");
    expect(recovered.errorMessage).toContain("Check Sent");
  });
});

describe("draft recovery selection", () => {
  const unregisterEditors: (() => void)[] = [];
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });
  afterEach(() => {
    for (const unregister of unregisterEditors.splice(0)) {
      unregister();
    }
    vi.unstubAllGlobals();
  });

  it("hides recovery while composing and retains copies when the editor closes", () => {
    draftRecoveryJournal.save({
      editorId: "old-editor",
      localId: draft.localId,
      mailboxId: "mailbox",
      payload: JSON.stringify(draft),
      updatedAt: 10,
    });
    const unregister = draftRecoveryJournal.registerEditor({
      editorId: "active-editor",
      mailboxId: "mailbox",
    });
    unregisterEditors.push(unregister);
    expect(draftRecoveryJournal.listRecoverable("mailbox")).toHaveLength(0);
    expect(draftRecoveryJournal.list("mailbox")).toHaveLength(1);
    unregister();
    expect(draftRecoveryJournal.listRecoverable("mailbox")).toHaveLength(1);
  });

  it("does not discard a copy updated in another tab after the notice loaded", () => {
    const record = {
      editorId: "other-tab",
      localId: draft.localId,
      mailboxId: "mailbox",
      payload: JSON.stringify(draft),
      updatedAt: 10,
    };
    draftRecoveryJournal.save(record);
    draftRecoveryJournal.save({
      ...record,
      payload: JSON.stringify({ ...draft, bodyText: "Newer unsaved text" }),
      updatedAt: 20,
    });
    draftRecoveryJournal.remove(record);
    expect(draftRecoveryJournal.list("mailbox")).toHaveLength(1);
    expect(draftRecoveryJournal.list("mailbox")[0]?.payload).toContain(
      "Newer unsaved text"
    );
  });

  it("prefers the matching saved draft over a newer unsaved thread copy", () => {
    const current = restoreComposeDraft(
      JSON.stringify({
        ...draft,
        draftId: "saved-draft",
        localId: "current",
        replyContext: { references: [], threadId: "thread" },
      }),
      "current-editor"
    );
    draftRecoveryJournal.save({
      editorId: "old-editor",
      localId: "exact-copy",
      mailboxId: "mailbox",
      payload: JSON.stringify({
        ...current,
        bodyText: "Recovered edit",
        localId: "exact-copy",
      }),
      updatedAt: 10,
    });
    draftRecoveryJournal.save({
      editorId: "other-editor",
      localId: "thread-copy",
      mailboxId: "mailbox",
      payload: JSON.stringify({
        ...current,
        bodyText: "Different edit",
        draftId: undefined,
        localId: "thread-copy",
      }),
      updatedAt: 20,
    });
    expect(findRecoverableComposeDraft("mailbox", current)).toMatchObject({
      bodyText: "Recovered edit",
      draftId: "saved-draft",
    });
    expect(findRecoverableComposeDraft("other-mailbox", current)).toBeNull();
  });

  it("keeps newer server drafts and separate saved drafts intact", () => {
    const current = restoreComposeDraft(JSON.stringify(draft), "current");
    draftRecoveryJournal.save({
      editorId: "old-editor",
      localId: draft.localId,
      mailboxId: "mailbox",
      payload: JSON.stringify({ ...draft, draftId: "other-draft" }),
      updatedAt: 10,
    });
    expect(
      findRecoverableComposeDraft("mailbox", {
        ...current,
        lastSavedAt: 20,
      })
    ).toBeNull();
    expect(
      findRecoverableComposeDraft("mailbox", {
        ...current,
        draftId: "current-draft",
        localId: "separate-local",
      })
    ).toBeNull();
    expect(draftRecoveryJournal.list("mailbox")).toHaveLength(1);
  });

  it("does not attach an unrelated ID-less thread copy to a saved draft", () => {
    const current = restoreComposeDraft(
      JSON.stringify({
        ...draft,
        draftId: "saved-draft",
        localId: "saved-local",
        replyContext: { references: [], threadId: "shared-thread" },
      }),
      "saved-editor"
    );
    draftRecoveryJournal.save({
      editorId: "other-editor",
      localId: "other-local",
      mailboxId: "mailbox",
      payload: JSON.stringify({
        ...draft,
        localId: "other-local",
        replyContext: { references: [], threadId: "shared-thread" },
      }),
      updatedAt: 20,
    });
    expect(findRecoverableComposeDraft("mailbox", current)).toBeNull();
    expect(
      findRecoverableComposeDraft("mailbox", { ...current, draftId: undefined })
    ).toMatchObject({ localId: "other-local" });
  });
});
