import { z } from "zod";

import { requestResult, runTransaction } from "./indexed-db";

const recordSchema = z.object({
  editorId: z.string(),
  localId: z.string(),
  mailboxId: z.string(),
  payload: z.string().max(8 * 1024 * 1024),
  updatedAt: z.number(),
});
export type LocalDraftRecord = z.infer<typeof recordSchema>;

export class DraftJournal {
  private readonly database: IDBDatabase;
  private readonly generation: string | null;
  private readonly revoked = new Set<string>();
  private readonly mailboxGenerations = new Map<string, string | null>();
  private closed = false;

  private constructor(database: IDBDatabase, generation: string | null) {
    this.database = database;
    this.generation = generation;
  }

  static async open(userId: string) {
    const request = indexedDB.open(`quieter-drafts-v1:${userId}`, 1);
    const unavailable = Promise.withResolvers<never>();
    let abandoned = false;
    const timeout = setTimeout(() => {
      unavailable.reject(new Error("Draft recovery storage is unavailable."));
    }, 5000);
    request.onblocked = () => {
      unavailable.reject(new Error("Draft recovery storage is blocked."));
    };
    request.onupgradeneeded = () => {
      request.result
        .createObjectStore("drafts", {
          keyPath: ["mailboxId", "localId", "editorId"],
        })
        .createIndex("mailbox", "mailboxId");
      request.result.createObjectStore("settings");
    };
    request.addEventListener("success", () => {
      if (abandoned) {
        request.result.close();
      }
    });
    let result: unknown;
    try {
      result = await Promise.race([
        requestResult(request),
        unavailable.promise,
      ]);
    } catch (error) {
      abandoned = true;
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (!(result instanceof IDBDatabase)) {
      throw new Error("Draft recovery storage could not be opened.");
    }
    const generation = await requestResult(
      result.transaction("settings").objectStore("settings").get("generation")
    );
    const journal = new DraftJournal(
      result,
      generation === undefined ? null : z.string().parse(generation)
    );
    result.onversionchange = () => {
      journal.close();
    };
    return journal;
  }

  async save(input: LocalDraftRecord) {
    if (this.closed || this.revoked.has(input.mailboxId)) {
      throw new DOMException(
        "Draft recovery storage was closed.",
        "AbortError"
      );
    }
    const record = recordSchema.parse(input);
    await runTransaction(
      this.database,
      ["drafts", "settings"],
      "readwrite",
      async (transaction) => {
        const settings = transaction.objectStore("settings");
        const generation = await requestResult(settings.get("generation"));
        const mailboxGeneration = await requestResult(
          settings.get(`mailbox:${record.mailboxId}`)
        );
        if (
          (generation ?? null) !== this.generation ||
          (mailboxGeneration ?? null) !==
            this.mailboxGenerations.get(record.mailboxId)
        ) {
          throw new DOMException("Draft recovery access ended.", "AbortError");
        }
        transaction.objectStore("drafts").put(record);
      }
    );
  }

  async list(mailboxId: string) {
    if (this.closed || this.revoked.has(mailboxId)) {
      return [];
    }
    const records = await requestResult(
      this.database
        .transaction("drafts")
        .objectStore("drafts")
        .index("mailbox")
        .getAll(mailboxId)
    );
    return z
      .array(recordSchema)
      .parse(records)
      .toSorted((left, right) => right.updatedAt - left.updatedAt);
  }

  async remove(
    record: Pick<LocalDraftRecord, "mailboxId" | "localId" | "editorId">
  ) {
    if (this.closed) {
      return;
    }
    await runTransaction(
      this.database,
      ["drafts"],
      "readwrite",
      async (transaction) => {
        await requestResult(
          transaction
            .objectStore("drafts")
            .delete([record.mailboxId, record.localId, record.editorId])
        );
      }
    );
  }

  async authorize(mailboxId: string) {
    this.revoked.delete(mailboxId);
    await runTransaction(
      this.database,
      ["settings"],
      "readwrite",
      async (transaction) => {
        const settings = transaction.objectStore("settings");
        const generation = await requestResult(settings.get("generation"));
        if ((generation ?? null) !== this.generation) {
          throw new DOMException("Draft recovery access ended.", "AbortError");
        }
        const mailboxGeneration = await requestResult(
          settings.get(`mailbox:${mailboxId}`)
        );
        this.mailboxGenerations.set(
          mailboxId,
          mailboxGeneration === undefined
            ? null
            : z.string().parse(mailboxGeneration)
        );
      }
    );
  }

  async revoke(mailboxId: string) {
    this.revoked.add(mailboxId);
    await runTransaction(
      this.database,
      ["drafts", "settings"],
      "readwrite",
      async (transaction) => {
        const store = transaction.objectStore("drafts");
        const keys = await requestResult(
          store.index("mailbox").getAllKeys(mailboxId)
        );
        for (const key of z.array(z.array(z.string())).parse(keys)) {
          store.delete(key);
        }
        transaction
          .objectStore("settings")
          .put(crypto.randomUUID(), `mailbox:${mailboxId}`);
      }
    );
  }

  async purge() {
    this.closed = true;
    try {
      await runTransaction(
        this.database,
        ["drafts", "settings"],
        "readwrite",
        async (transaction) => {
          await requestResult(transaction.objectStore("drafts").clear());
          transaction
            .objectStore("settings")
            .put(crypto.randomUUID(), "generation");
        }
      );
    } finally {
      this.database.close();
    }
  }

  close() {
    this.closed = true;
    this.database.close();
  }
}
