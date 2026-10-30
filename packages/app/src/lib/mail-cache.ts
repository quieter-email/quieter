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
  epochs: { key: string; value: string };
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
  let sessionId: string | undefined;
  let generation = 0;
  let userGeneration = 0;
  let initialized = false;
  const protectedKeys = new Set<string>();
  let database: ReturnType<typeof openDB<MailCacheDatabase>> | undefined;
  let connection:
    | Awaited<ReturnType<typeof openDB<MailCacheDatabase>>>
    | undefined;
  const open = async () => {
    database ??= openDB<MailCacheDatabase>(
      options.name ?? "quieter-mail-cache-v1",
      2,
      {
        blocking() {
          connection?.close();
          database = undefined;
        },
        terminated() {
          database = undefined;
        },
        upgrade(db, oldVersion) {
          db.createObjectStore("epochs");
          if (oldVersion !== 0) {
            return;
          }
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
  let databaseEpoch: string | undefined;

  const changeUser = async (
    next: string | undefined,
    identity = next,
    force = false
  ) => {
    if (!force && initialized && next === userId && identity === sessionId) {
      await initialization;
      return;
    }
    initialized = true;
    const previousUser = userId;
    const previousSession = sessionId;
    userId = next;
    sessionId = identity;
    generation += 1;
    userGeneration += 1;
    protectedKeys.clear();
    const previous = initialization;
    const transition = (async () => {
      await previous;
      const db = await open();
      const tx = db.transaction(["entries", "values", "epochs"], "readwrite");
      void (async () => {
        try {
          await tx.done;
        } catch {
          /* Request failures below still propagate through transition. */
        }
      })();
      if (
        identity &&
        (await tx.objectStore("epochs").get(`identity:${identity}`)) ===
          "revoked"
      ) {
        databaseEpoch = undefined;
        await tx.done;
        return;
      }
      // Logout must commit even if another login has already changed local state.
      let revoked =
        next === undefined ||
        (previousUser !== undefined &&
          (previousUser !== next || previousSession !== identity));
      let cursor = await tx.objectStore("entries").openCursor();
      while (cursor !== null) {
        if (cursor.value.userId !== next) {
          revoked = true;
          await tx.objectStore("values").delete(cursor.key);
          await cursor.delete();
        }
        cursor = await cursor.continue();
      }
      if (next === undefined) {
        await tx.objectStore("values").clear();
      }
      if (revoked) {
        for (const key of await tx.objectStore("epochs").getAllKeys()) {
          if (key.startsWith("identity:") && key !== `identity:${identity}`) {
            await tx.objectStore("epochs").put("revoked", key);
          }
        }
      }
      if (identity) {
        await tx.objectStore("epochs").put("active", `identity:${identity}`);
      }
      databaseEpoch = revoked
        ? crypto.randomUUID()
        : ((await tx.objectStore("epochs").get("session")) ?? "");
      await tx.objectStore("epochs").put(databaseEpoch, "session");
      await tx.done;
    })();
    initialization = (async () => {
      try {
        await transition;
      } catch {
        /* Normal initialization is optional. Explicit cleanup awaits transition. */
      }
    })();
    await transition;
  };

  return {
    async clear() {
      await changeUser(undefined, undefined, true);
    },
    detach() {
      initialized = true;
      userId = undefined;
      sessionId = undefined;
      generation += 1;
      userGeneration += 1;
      protectedKeys.clear();
      databaseEpoch = undefined;
    },
    async entries(): Promise<[string, string][]> {
      const owner = userId;
      if (!owner) {
        return [];
      }
      try {
        await initialization;
        const db = await open();
        const tx = db.transaction(["entries", "values", "epochs"]);
        if (
          ((await tx.objectStore("epochs").get("session")) ?? "") !==
          databaseEpoch
        ) {
          await tx.done;
          return [];
        }
        const entries = await tx
          .objectStore("entries")
          .index("userId")
          .getAll(owner);
        const values = await Promise.all(
          entries
            .filter((entry) => entry.key.startsWith(`${owner}:quieter-cache-`))
            .map(async (entry): Promise<[string, string]> => [
              entry.key.slice(owner.length + 1),
              (await tx.objectStore("values").get(entry.key)) ?? "",
            ])
        );
        await tx.done;
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
        const tx = db.transaction(["entries", "values", "epochs"], "readwrite");
        if (
          ((await tx.objectStore("epochs").get("session")) ?? "") !==
          databaseEpoch
        ) {
          await tx.done;
          return null;
        }
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
    async removeCalendarScope(connectionId: string, calendarId?: string) {
      const owner = userId;
      const ownerGeneration = userGeneration;
      generation += 1;
      if (!owner) {
        return;
      }
      try {
        await initialization;
        const db = await open();
        if (ownerGeneration !== userGeneration) {
          return;
        }
        const tx = db.transaction(["entries", "values", "epochs"], "readwrite");
        if (
          ((await tx.objectStore("epochs").get("session")) ?? "") !==
          databaseEpoch
        ) {
          await tx.done;
          return;
        }
        const completion = (async () => {
          try {
            await tx.done;
          } catch {
            /* Persistence is optional. */
          }
        })();
        const entries = await tx
          .objectStore("entries")
          .index("userId")
          .getAll(owner);
        for (const entry of entries) {
          const key = entry.key.slice(owner.length + 1);
          if (!key.startsWith("quieter-cache-")) {
            continue;
          }
          const parts: unknown = JSON.parse(key.slice("quieter-cache-".length));
          if (
            Array.isArray(parts) &&
            parts[0] === "calendar" &&
            parts[1] === owner &&
            parts[2] === "connection" &&
            parts[3] === connectionId &&
            (calendarId === undefined ||
              (parts[4] === "calendar" && parts[5] === calendarId))
          ) {
            await tx.objectStore("entries").delete(entry.key);
            await tx.objectStore("values").delete(entry.key);
          }
        }
        await completion;
      } catch {
        /* Persistence is optional. */
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
        const tx = db.transaction(["entries", "values", "epochs"], "readwrite");
        if (
          ((await tx.objectStore("epochs").get("session")) ?? "") !==
          databaseEpoch
        ) {
          await tx.done;
          return;
        }
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
        const tx = db.transaction(["entries", "values", "epochs"], "readwrite");
        if (
          ((await tx.objectStore("epochs").get("session")) ?? "") !==
          databaseEpoch
        ) {
          await tx.done;
          return;
        }
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
          const tx = db.transaction(
            ["entries", "values", "epochs"],
            "readwrite"
          );
          // Attach immediately: a quota abort rejects both the request and transaction.
          const completion = (async () => {
            try {
              await tx.done;
            } catch {
              /* Request handling below determines recovery. */
            }
          })();
          try {
            if (
              ((await tx.objectStore("epochs").get("session")) ?? "") !==
              databaseEpoch
            ) {
              await tx.done;
              return;
            }
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
    async setUser(next: string | undefined, identity = next) {
      try {
        await changeUser(next, identity);
      } catch {
        /* The browser may deny optional persistence. */
      }
    },
  };
};

export const mailCache = createMailCache();
