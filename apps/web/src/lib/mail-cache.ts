import { openDB } from "idb";
import type { DBSchema } from "idb";

export const MAIL_CACHE_BUDGET = 100_000_000;
export const MAIL_CACHE_MAX_AGE = 30 * 24 * 60 * 60_000;

type CacheEntry = {
  key: string;
  bytes: number;
  accessedAt: number;
  expiresAt: number;
  userId: string;
};
type MailCacheDatabase = {
  values: { key: string; value: string };
  entries: {
    key: string;
    value: CacheEntry;
    indexes: { accessedAt: number; userId: string };
  };
} & DBSchema;

export const createMailCache = (
  options: { name?: string; budget?: number; now?: () => number } = {}
) => {
  const budget = options.budget ?? MAIL_CACHE_BUDGET;
  const now = options.now ?? Date.now;
  let userId: string | undefined;
  let generation = 0;
  let initialized = false;
  const protectedKeys = new Set<string>();
  let database: ReturnType<typeof openDB<MailCacheDatabase>> | undefined;
  let connection:
    | Awaited<ReturnType<typeof openDB<MailCacheDatabase>>>
    | undefined;
  const open = async () => {
    database ??= openDB<MailCacheDatabase>(
      options.name ?? "quieter-mail-cache-v1",
      1,
      {
        blocking() {
          connection?.close();
          database = undefined;
        },
        terminated() {
          database = undefined;
        },
        upgrade(db) {
          db.createObjectStore("values");
          const entries = db.createObjectStore("entries", { keyPath: "key" });
          entries.createIndex("accessedAt", "accessedAt");
          entries.createIndex("userId", "userId");
        },
      }
    );
    try {
      connection = await database;
      return connection;
    } catch (error) {
      database = undefined;
      throw error;
    }
  };
  let initialization = Promise.resolve();

  return {
    async entries(): Promise<[string, string][]> {
      const owner = userId;
      if (!owner) {
        return [];
      }
      try {
        await initialization;
        const db = await open();
        const entries = await db.getAllFromIndex("entries", "userId", owner);
        const values = await Promise.all(
          entries.map(async (entry): Promise<[string, string]> => [
            entry.key.slice(owner.length + 1),
            (await db.get("values", entry.key)) ?? "",
          ])
        );
        return owner === userId ? values : [];
      } catch {
        return [];
      }
    },
    async getItem(key: string) {
      const owner = userId;
      const epoch = generation;
      if (!owner) {
        return null;
      }
      try {
        await initialization;
        const db = await open();
        if (epoch !== generation) {
          return null;
        }
        const tx = db.transaction(["entries", "values"], "readwrite");
        const entry = await tx.objectStore("entries").get(`${owner}:${key}`);
        if (!entry) {
          await tx.done;
          return null;
        }
        if (entry.expiresAt <= now()) {
          await tx.objectStore("entries").delete(entry.key);
          await tx.objectStore("values").delete(entry.key);
          await tx.done;
          return null;
        }
        await tx.objectStore("entries").put({ ...entry, accessedAt: now() });
        const value = await tx.objectStore("values").get(entry.key);
        await tx.done;
        return epoch === generation ? (value ?? null) : null;
      } catch {
        return null;
      }
    },
    protect(key: string, protect: boolean) {
      if (protect) {
        protectedKeys.add(key);
      } else {
        protectedKeys.delete(key);
      }
    },
    async removeItem(key: string) {
      const owner = userId;
      if (!owner) {
        return;
      }
      try {
        await initialization;
        const db = await open();
        const tx = db.transaction(["entries", "values"], "readwrite");
        await tx.objectStore("entries").delete(`${owner}:${key}`);
        await tx.objectStore("values").delete(`${owner}:${key}`);
        await tx.done;
      } catch {
        /* Optional cache. */
      }
    },
    async removeMailbox(mailboxId: string) {
      const owner = userId;
      const epoch = generation;
      if (!owner) {
        return;
      }
      try {
        await initialization;
        const db = await open();
        if (epoch !== generation) {
          return;
        }
        const tx = db.transaction(["entries", "values"], "readwrite");
        const completion = (async () => {
          try {
            await tx.done;
          } catch {
            /* Request handling below determines recovery. */
          }
        })();
        const entries = await tx
          .objectStore("entries")
          .index("userId")
          .getAll(owner);
        for (const entry of entries) {
          const key = entry.key.slice(owner.length + 1);
          const prefix = key.startsWith("body-") ? "body-" : "quieter-cache-";
          if (!key.startsWith(prefix)) {
            continue;
          }
          const parts: unknown = JSON.parse(key.slice(prefix.length));
          if (!Array.isArray(parts)) {
            continue;
          }
          const keys: readonly unknown[] = parts;
          const [root, scope, threadScope] = keys;
          let entryMailbox: unknown = scope;
          if (prefix === "body-") {
            entryMailbox = root;
          } else if (root === "message-thread") {
            entryMailbox = threadScope;
          }
          if (entryMailbox === mailboxId) {
            await tx.objectStore("entries").delete(entry.key);
            await tx.objectStore("values").delete(entry.key);
          }
        }
        await completion;
      } catch {
        /* Optional cache. */
      }
    },
    async setItem(key: string, value: string) {
      const owner = userId;
      const epoch = generation;
      if (!owner) {
        return;
      }
      const bytes =
        new TextEncoder().encode(value).byteLength + key.length * 2 + 256;
      if (bytes > budget) {
        return;
      }
      try {
        await initialization;
        const db = await open();
        for (const quotaRetry of [false, true]) {
          if (epoch !== generation) {
            return;
          }
          const tx = db.transaction(["entries", "values"], "readwrite");
          // Attach immediately: a quota abort rejects both the request and transaction.
          const completion = (async () => {
            try {
              await tx.done;
            } catch {
              /* Request handling below determines recovery. */
            }
          })();
          try {
            const entries = await tx
              .objectStore("entries")
              .index("accessedAt")
              .getAll();
            let total = entries.reduce(
              (sum, entry) =>
                sum + (entry.key === `${owner}:${key}` ? 0 : entry.bytes),
              0
            );
            const target = quotaRetry ? Math.max(0, total * 0.5) : budget * 0.9;
            const evict = quotaRetry || total + bytes > budget;
            for (const entry of entries) {
              if (entry.key === `${owner}:${key}`) {
                continue;
              }
              const expired = entry.expiresAt <= now();
              const pinned = protectedKeys.has(
                entry.key.slice(owner.length + 1)
              );
              if (expired || (evict && total + bytes > target && !pinned)) {
                await tx.objectStore("entries").delete(entry.key);
                await tx.objectStore("values").delete(entry.key);
                total -= entry.bytes;
              }
            }
            if (total + bytes > budget) {
              await completion;
              return;
            }
            if (epoch !== generation) {
              tx.abort();
              await completion;
              return;
            }
            await tx.objectStore("entries").put({
              accessedAt: now(),
              bytes,
              expiresAt: now() + MAIL_CACHE_MAX_AGE,
              key: `${owner}:${key}`,
              userId: owner,
            });
            await tx.objectStore("values").put(value, `${owner}:${key}`);
            await tx.done;
            return;
          } catch (error) {
            await completion;
            if (
              quotaRetry ||
              !(error instanceof DOMException) ||
              error.name !== "QuotaExceededError"
            ) {
              return;
            }
          }
        }
      } catch {
        /* Fall back only after eviction/retry or unavailable storage. */
      }
    },
    setUser(next: string | undefined) {
      if (initialized && next === userId) {
        return;
      }
      initialized = true;
      userId = next;
      generation += 1;
      protectedKeys.clear();
      const previous = initialization;
      initialization = (async () => {
        try {
          await previous;
          const db = await open();
          const tx = db.transaction(["entries", "values"], "readwrite");
          let cursor = await tx.objectStore("entries").openCursor();
          while (cursor !== null) {
            if (cursor.value.userId !== userId) {
              await tx.objectStore("values").delete(cursor.key);
              await cursor.delete();
            }
            cursor = await cursor.continue();
          }
          await tx.done;
        } catch {
          /* The browser may deny storage. */
        }
      })();
    },
  };
};

export const mailCache = createMailCache();
