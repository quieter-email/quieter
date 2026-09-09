import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { DraftJournal } from "../src/draft-journal";
import { ReplicaStorage } from "../src/storage";

const journals: DraftJournal[] = [];
const open = async (userId: string) => {
  const journal = await DraftJournal.open(userId);
  journals.push(journal);
  await journal.authorize("first");
  await journal.authorize("second");
  return journal;
};
const draft = {
  editorId: "editor-a",
  localId: "draft",
  mailboxId: "first",
  payload: "unfinished text",
  updatedAt: 1,
};

describe("draft recovery journal", () => {
  afterEach(() => {
    for (const journal of journals.splice(0)) {
      journal.close();
    }
  });

  it("keeps independent editor copies across cache clearing and reload", async () => {
    const userId = crypto.randomUUID();
    const journal = await open(userId);
    await journal.save(draft);
    await journal.save({
      ...draft,
      editorId: "editor-b",
      payload: "other edits",
      updatedAt: 2,
    });
    const cache = await ReplicaStorage.open(userId);
    await cache.shutdownAndPurge();
    journal.close();
    const reloaded = await open(userId);
    await expect(reloaded.list("first")).resolves.toHaveLength(2);
    await reloaded.remove(draft);
    await expect(reloaded.list("first")).resolves.toStrictEqual([
      { ...draft, editorId: "editor-b", payload: "other edits", updatedAt: 2 },
    ]);
  });

  it("isolates users and mailboxes and fences stale writers after revocation", async () => {
    const userId = crypto.randomUUID();
    const first = await open(userId);
    const stale = await open(userId);
    const other = await open(crypto.randomUUID());
    await first.save(draft);
    await first.save({ ...draft, mailboxId: "second" });
    await expect(other.list("first")).resolves.toStrictEqual([]);
    await first.revoke("first");
    await expect(first.list("first")).resolves.toStrictEqual([]);
    await expect(first.list("second")).resolves.toHaveLength(1);
    await expect(stale.save(draft)).rejects.toThrow("access ended");
    await first.authorize("first");
    await first.save({ ...draft, payload: "new authorized draft" });
    await expect(stale.save(draft)).rejects.toThrow("access ended");
  });

  it("prevents a late tab from recreating drafts after logout", async () => {
    const userId = crypto.randomUUID();
    const first = await open(userId);
    const stale = await open(userId);
    await first.save(draft);
    await first.purge();
    await expect(stale.save(draft)).rejects.toThrow("access ended");
    await expect(stale.authorize("first")).rejects.toThrow("access ended");
    const signedIn = await open(userId);
    await expect(signedIn.list("first")).resolves.toStrictEqual([]);
    await signedIn.save(draft);
    await expect(signedIn.list("first")).resolves.toHaveLength(1);
  });
});
