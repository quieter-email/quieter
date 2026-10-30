import {
  findRecoverableComposeDraft,
  restoreComposeDraft,
} from "@quieter/app/features/compose/domain/draft-recovery";
import { draftRecoveryJournal } from "@quieter/app/lib/draft-recovery-journal";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

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
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      },
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    });
    draftRecoveryJournal.setUser("user-a");
  });
  afterEach(() => {
    for (const unregister of unregisterEditors.splice(0)) {
      unregister();
    }
    vi.unstubAllGlobals();
  });

  it("isolates shared-mailbox drafts across accounts and preserves refresh recovery", () => {
    const scope = { mailboxId: "shared", userId: "user-a" };
    const record = {
      ...scope,
      editorId: "owner-editor",
      localId: draft.localId,
      payload: JSON.stringify(draft),
      updatedAt: 10,
    };
    draftRecoveryJournal.save(record);
    draftRecoveryJournal.setUser("user-a");
    expect(draftRecoveryJournal.listRecoverable(scope)).toHaveLength(1);
    const current = restoreComposeDraft(JSON.stringify(draft), "current");
    expect(
      findRecoverableComposeDraft({ ...scope, userId: "user-b" }, current)
    ).toBeNull();
    const unregister = draftRecoveryJournal.registerEditor(record);
    unregisterEditors.push(unregister);
    draftRecoveryJournal.setUser("user-b");
    draftRecoveryJournal.save(record);
    expect(draftRecoveryJournal.list(scope)).toHaveLength(0);
    expect(
      draftRecoveryJournal.listRecoverable({ ...scope, userId: "user-b" })
    ).toHaveLength(0);
    draftRecoveryJournal.setUser("user-a");
    draftRecoveryJournal.save(record);
    expect(draftRecoveryJournal.list(scope)).toHaveLength(0);
  });

  it("clears and revokes a confirmed native sign-out without a session refetch", () => {
    const record = {
      editorId: "native-editor",
      localId: draft.localId,
      mailboxId: "shared",
      payload: JSON.stringify(draft),
      updatedAt: 10,
      userId: "user-a",
    };
    draftRecoveryJournal.save(record);
    const unregister = draftRecoveryJournal.registerEditor(record);
    unregisterEditors.push(unregister);
    draftRecoveryJournal.setUser(undefined);
    draftRecoveryJournal.save(record);
    expect(draftRecoveryJournal.list(record)).toHaveLength(0);
    unregister();
    expect(draftRecoveryJournal.listRecoverable(record)).toHaveLength(0);
    expect(
      findRecoverableComposeDraft(
        record,
        restoreComposeDraft(JSON.stringify(draft), "current")
      )
    ).toBeNull();
    draftRecoveryJournal.setUser("user-a");
    draftRecoveryJournal.save(record);
    expect(draftRecoveryJournal.list(record)).toHaveLength(0);
    draftRecoveryJournal.save({ ...record, editorId: "native-fresh-editor" });
    expect(draftRecoveryJournal.listRecoverable(record)).toHaveLength(1);
  });

  it("does not restore legacy or incorrectly attributed records", () => {
    const scope = { mailboxId: "shared", userId: "user-a" };
    const record = {
      ...scope,
      editorId: "mismatched-editor",
      localId: draft.localId,
      payload: JSON.stringify(draft),
      updatedAt: 10,
    };
    draftRecoveryJournal.save(record);
    const key = localStorage.key(0);
    expect(key).not.toBeNull();
    if (key === null) {
      throw new Error("Recovery key missing");
    }
    localStorage.setItem(
      key,
      JSON.stringify([
        { ...record, userId: "user-b" },
        { ...record, mailboxId: "other" },
      ])
    );
    localStorage.setItem(
      "quieter:draft-recovery:shared",
      JSON.stringify([record])
    );
    expect(draftRecoveryJournal.listRecoverable(scope)).toHaveLength(0);
    expect(
      findRecoverableComposeDraft(
        scope,
        restoreComposeDraft(JSON.stringify(draft), "current")
      )
    ).toBeNull();
    expect(localStorage.getItem("quieter:draft-recovery:shared")).toBeNull();
  });

  it("keeps mailbox and user cleanup independent", () => {
    const record = {
      editorId: "editor",
      localId: draft.localId,
      mailboxId: "one",
      payload: JSON.stringify(draft),
      updatedAt: 10,
      userId: "user-a",
    };
    draftRecoveryJournal.save(record);
    draftRecoveryJournal.save({ ...record, mailboxId: "two" });
    expect(
      draftRecoveryJournal.list({ mailboxId: "one", userId: "user-a" })
    ).toHaveLength(1);
    expect(
      draftRecoveryJournal.list({ mailboxId: "two", userId: "user-a" })
    ).toHaveLength(1);
    draftRecoveryJournal.remove({ ...record, userId: "user-b" });
    expect(draftRecoveryJournal.list(record)).toHaveLength(1);
    draftRecoveryJournal.clearUser("user-b");
    expect(draftRecoveryJournal.list(record)).toHaveLength(1);
    draftRecoveryJournal.clearUser("user-a");
    expect(draftRecoveryJournal.list(record)).toHaveLength(0);
    expect(
      draftRecoveryJournal.list({ ...record, mailboxId: "two" })
    ).toHaveLength(0);
  });

  it("clears only the departing principal when another tab has its own copy", () => {
    const other = {
      editorId: "other-owner-editor",
      localId: draft.localId,
      mailboxId: "shared",
      payload: JSON.stringify(draft),
      updatedAt: 10,
      userId: "user-b",
    };
    draftRecoveryJournal.setUser("user-b");
    draftRecoveryJournal.save(other);
    const key = localStorage.key(0);
    if (key === null) {
      throw new Error("Recovery key missing");
    }
    const serialized = localStorage.getItem(key);
    if (serialized === null) {
      throw new Error("Recovery record missing");
    }
    draftRecoveryJournal.setUser("user-a");
    localStorage.setItem(key, serialized);
    const own = { ...other, editorId: "own-editor", userId: "user-a" };
    draftRecoveryJournal.save(own);
    const unregister = draftRecoveryJournal.registerEditor(own);
    unregisterEditors.push(unregister);
    expect(draftRecoveryJournal.listRecoverable(other)).toHaveLength(0);
    expect(localStorage.getItem(key)).toBe(serialized);
    draftRecoveryJournal.clearUser("user-a");
    expect(draftRecoveryJournal.list(own)).toHaveLength(0);
    draftRecoveryJournal.setUser("user-b");
    expect(draftRecoveryJournal.listRecoverable(other)).toHaveLength(1);
  });

  it("hides recovery while composing and retains copies when the editor closes", () => {
    draftRecoveryJournal.save({
      editorId: "old-editor",
      localId: draft.localId,
      mailboxId: "mailbox",
      payload: JSON.stringify(draft),
      updatedAt: 10,
      userId: "user-a",
    });
    const unregister = draftRecoveryJournal.registerEditor({
      editorId: "active-editor",
      mailboxId: "mailbox",
      userId: "user-a",
    });
    unregisterEditors.push(unregister);
    expect(
      draftRecoveryJournal.listRecoverable({
        mailboxId: "mailbox",
        userId: "user-a",
      })
    ).toHaveLength(0);
    expect(
      draftRecoveryJournal.list({ mailboxId: "mailbox", userId: "user-a" })
    ).toHaveLength(1);
    unregister();
    expect(
      draftRecoveryJournal.listRecoverable({
        mailboxId: "mailbox",
        userId: "user-a",
      })
    ).toHaveLength(1);
  });

  it("does not discard a copy updated in another tab after the notice loaded", () => {
    const record = {
      editorId: "other-tab",
      localId: draft.localId,
      mailboxId: "mailbox",
      payload: JSON.stringify(draft),
      updatedAt: 10,
      userId: "user-a",
    };
    draftRecoveryJournal.save(record);
    draftRecoveryJournal.save({
      ...record,
      payload: JSON.stringify({ ...draft, bodyText: "Newer unsaved text" }),
      updatedAt: 20,
    });
    draftRecoveryJournal.remove(record);
    expect(
      draftRecoveryJournal.list({ mailboxId: "mailbox", userId: "user-a" })
    ).toHaveLength(1);
    expect(
      draftRecoveryJournal.list({ mailboxId: "mailbox", userId: "user-a" })[0]
        ?.payload
    ).toContain("Newer unsaved text");
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
      userId: "user-a",
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
      userId: "user-a",
    });
    expect(
      findRecoverableComposeDraft(
        { mailboxId: "mailbox", userId: "user-a" },
        current
      )
    ).toMatchObject({
      bodyText: "Recovered edit",
      draftId: "saved-draft",
    });
    expect(
      findRecoverableComposeDraft(
        { mailboxId: "other-mailbox", userId: "user-a" },
        current
      )
    ).toBeNull();
  });

  it("keeps newer server drafts and separate saved drafts intact", () => {
    const current = restoreComposeDraft(JSON.stringify(draft), "current");
    draftRecoveryJournal.save({
      editorId: "old-editor",
      localId: draft.localId,
      mailboxId: "mailbox",
      payload: JSON.stringify({ ...draft, draftId: "other-draft" }),
      updatedAt: 10,
      userId: "user-a",
    });
    expect(
      findRecoverableComposeDraft(
        { mailboxId: "mailbox", userId: "user-a" },
        {
          ...current,
          lastSavedAt: 20,
        }
      )
    ).toBeNull();
    expect(
      findRecoverableComposeDraft(
        { mailboxId: "mailbox", userId: "user-a" },
        {
          ...current,
          draftId: "current-draft",
          localId: "separate-local",
        }
      )
    ).toBeNull();
    expect(
      draftRecoveryJournal.list({ mailboxId: "mailbox", userId: "user-a" })
    ).toHaveLength(1);
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
      userId: "user-a",
    });
    expect(
      findRecoverableComposeDraft(
        { mailboxId: "mailbox", userId: "user-a" },
        current
      )
    ).toBeNull();
    expect(
      findRecoverableComposeDraft(
        { mailboxId: "mailbox", userId: "user-a" },
        { ...current, draftId: undefined }
      )
    ).toMatchObject({ localId: "other-local" });
  });
});
