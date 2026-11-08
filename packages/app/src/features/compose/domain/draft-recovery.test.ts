import "fake-indexeddb/auto";
import {
  findRecoverableComposeDraft,
  restoreComposeDraft,
} from "@quieter/app/features/compose/domain/draft-recovery";
import { createDraftRecoveryJournal } from "@quieter/app/lib/draft-recovery-journal";
import { createMailCache } from "@quieter/app/lib/mail-cache";
import { openDB } from "idb";
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
  it("does not silently retry a send interrupted by closing the tab", () => {
    const recovered = restoreComposeDraft(
      JSON.stringify({ ...draft, saveStatus: "sending" }),
      "editor"
    );
    expect(recovered.saveStatus).toBe("error");
    expect(recovered.errorMessage).toContain("Check Sent");
  });
});

describe("draft recovery ownership", () => {
  let name: string;
  let journal: ReturnType<typeof createDraftRecoveryJournal>;
  let recovery: ReturnType<
    ReturnType<typeof createDraftRecoveryJournal>["session"]
  >;
  const record = {
    editorId: "editor",
    localId: draft.localId,
    mailboxId: "mailbox",
    payload: JSON.stringify(draft),
    updatedAt: 10,
    userId: "user-a",
  };
  beforeEach(async () => {
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
    name = crypto.randomUUID();
    journal = createDraftRecoveryJournal(createMailCache({ name }));
    await journal.setUser("user-a", "old");
    recovery = journal.session("user-a", "old");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["user-a", "user-b"])(
    "preserves a fresh %s activation across delayed cleanup and rejects stale writers",
    async (userId) => {
      await recovery.save(record);
      const clearOld = journal.captureCleanup();
      const fresh = createDraftRecoveryJournal(createMailCache({ name }));
      await fresh.setUser(userId, "fresh");
      const active = fresh.session(userId, "fresh");
      await active.save({
        ...record,
        editorId: "fresh-editor",
        payload: "Fresh recovery",
        userId,
      });
      await clearOld?.();
      await recovery.save({ ...record, payload: "Forbidden stale edit" });
      await expect(recovery.list(record)).resolves.toHaveLength(0);
      const reload = createDraftRecoveryJournal(createMailCache({ name }));
      await reload.setUser(userId, "fresh");
      await expect(
        reload.session(userId, "fresh").list({ ...record, userId })
      ).resolves.toStrictEqual(
        expect.arrayContaining([
          expect.objectContaining({ payload: "Fresh recovery" }),
        ])
      );
      const staleReload = createDraftRecoveryJournal(createMailCache({ name }));
      await staleReload.setUser("user-a", "old");
      await staleReload.session("user-a", "old").save(record);
      await expect(
        staleReload.session("user-a", "old").list(record)
      ).resolves.toHaveLength(0);
    }
  );

  it("a stale discard cannot remove a newer checkpoint with the same timestamp", async () => {
    await recovery.save(record);
    const [old] = await recovery.list(record);
    if (old === undefined) {
      throw new Error("Missing original recovery");
    }
    await recovery.save({ ...record, payload: "Newer same-time edit" });
    await recovery.remove(old);
    await expect(recovery.list(record)).resolves.toMatchObject([
      { payload: "Newer same-time edit" },
    ]);
    const restored = restoreComposeDraft(
      old.payload,
      old.editorId,
      old.updatedAt,
      undefined,
      old.revision
    );
    const [newer] = await recovery.list(record);
    expect(newer?.revision).not.toBe(restored.recoveryRevision);
    await recovery.remove({ ...old, revision: restored.recoveryRevision });
    await expect(recovery.list(record)).resolves.toMatchObject([
      { payload: "Newer same-time edit" },
    ]);
  });

  it("serializes empty checkpoints with saves and leaves other editors intact", async () => {
    await recovery.save({
      ...record,
      editorId: "other",
      payload: "Other editor",
    });
    await Promise.all([recovery.save(record), recovery.remove(record)]);
    await expect(recovery.list(record)).resolves.toMatchObject([
      { editorId: "other", payload: "Other editor" },
    ]);
    await Promise.all([recovery.remove(record), recovery.save(record)]);
    await expect(recovery.list(record)).resolves.toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({ editorId: "editor" }),
        expect.objectContaining({ editorId: "other" }),
      ])
    );
  });

  it("hides recoverable copies during editing and keeps mailbox/user access scoped", async () => {
    await recovery.save(record);
    const unregister = recovery.registerEditor({
      ...record,
      editorId: "active-editor",
    });
    await expect(recovery.listRecoverable(record)).resolves.toHaveLength(0);
    await expect(recovery.list(record)).resolves.toHaveLength(1);
    unregister();
    await expect(recovery.listRecoverable(record)).resolves.toHaveLength(1);
    await expect(
      recovery.list({ ...record, mailboxId: "other" })
    ).resolves.toHaveLength(0);
    await expect(
      recovery.list({ ...record, userId: "other" })
    ).resolves.toHaveLength(0);
    await recovery.remove({ ...record, userId: "other" });
    await expect(recovery.list(record)).resolves.toHaveLength(1);
  });

  it("retains the previous checkpoint when a payload or commit request throws", async () => {
    await recovery.save(record);
    // oxlint-disable-next-line typescript/unbound-method -- Invoked with its original object store below.
    const originalPut = IDBObjectStore.prototype.put;
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function put(
        this: IDBObjectStore,
        value: unknown,
        storageKey?: IDBValidKey
      ) {
        if (this.name === "recovery") {
          throw new DOMException("quota denied", "QuotaExceededError");
        }
        return originalPut.call(this, value, storageKey);
      });
    try {
      await expect(
        recovery.save({ ...record, payload: "Uncommitted edit" })
      ).rejects.toThrow(/denied/u);
    } finally {
      put.mockRestore();
    }
    await expect(recovery.list(record)).resolves.toMatchObject([
      { payload: record.payload },
    ]);
    const commit = vi
      .spyOn(IDBTransaction.prototype, "commit")
      .mockImplementationOnce(() => {
        throw new DOMException("commit denied", "UnknownError");
      });
    try {
      await expect(
        recovery.save({ ...record, payload: "Uncommitted edit" })
      ).rejects.toThrow(/denied/u);
    } finally {
      commit.mockRestore();
    }
    await expect(recovery.list(record)).resolves.toMatchObject([
      { payload: record.payload },
    ]);
  });

  it("consumes legacy import when cleanup precedes the first journal activation", async () => {
    const emptyName = crypto.randomUUID();
    const cache = createMailCache({ name: emptyName });
    await cache.setUser("user-a", "before-import");
    const key = `quieter:draft-recovery-v2:${JSON.stringify(["user-a", "mailbox"])}`;
    localStorage.setItem(key, JSON.stringify([record]));
    const remove = vi
      .spyOn(localStorage, "removeItem")
      .mockImplementationOnce(() => {
        throw new Error("legacy removal denied");
      });
    try {
      await expect(cache.captureCleanup()?.()).rejects.toThrow(/denied/u);
    } finally {
      remove.mockRestore();
    }
    expect(localStorage.getItem(key)).not.toBeNull();
    const fresh = createDraftRecoveryJournal(
      createMailCache({ name: emptyName })
    );
    await fresh.setUser("user-a", "after-clear");
    await expect(
      fresh.session("user-a", "after-clear").list(record)
    ).resolves.toHaveLength(0);
    await fresh
      .session("user-a", "after-clear")
      .save({ ...record, payload: "Legitimate new recovery" });
    await expect(
      fresh.session("user-a", "after-clear").list(record)
    ).resolves.toMatchObject([{ payload: "Legitimate new recovery" }]);
  });

  it("keeps local fences closed after cleanup storage denial", async () => {
    await recovery.save(record);
    const clear = vi
      .spyOn(IDBObjectStore.prototype, "clear")
      .mockImplementationOnce(() => {
        throw new Error("storage denied");
      });
    try {
      await expect(journal.setUser(undefined)).rejects.toThrow(/denied/u);
    } finally {
      clear.mockRestore();
    }
    await recovery.save({ ...record, payload: "Forbidden after denial" });
    await expect(recovery.list(record)).resolves.toHaveLength(0);
    const retry = journal.captureCleanup();
    expect(retry).toBeTypeOf("function");
    await retry?.();
    const db = await openDB(name);
    await expect(db.getAll("recovery")).resolves.toHaveLength(0);
    db.close();
  });

  it("prefers matching saved-draft recovery and preserves newer server state", async () => {
    const current = restoreComposeDraft(
      JSON.stringify({
        ...draft,
        draftId: "saved",
        localId: "current",
        replyContext: { references: [], threadId: "thread" },
      }),
      "current"
    );
    await recovery.save({
      ...record,
      editorId: "exact",
      localId: "exact",
      payload: JSON.stringify({
        ...current,
        bodyText: "Recovered edit",
        localId: "exact",
      }),
    });
    await recovery.save({
      ...record,
      editorId: "thread",
      localId: "thread",
      payload: JSON.stringify({
        ...current,
        bodyText: "Unrelated thread edit",
        draftId: undefined,
        localId: "thread",
      }),
      updatedAt: 20,
    });
    await expect(
      findRecoverableComposeDraft(record, current, recovery)
    ).resolves.toMatchObject({ bodyText: "Recovered edit", draftId: "saved" });
    await expect(
      findRecoverableComposeDraft(
        record,
        { ...current, lastSavedAt: 30 },
        recovery
      )
    ).resolves.toBeNull();
    await expect(
      findRecoverableComposeDraft(
        { ...record, mailboxId: "other" },
        current,
        recovery
      )
    ).resolves.toBeNull();
  });
});
