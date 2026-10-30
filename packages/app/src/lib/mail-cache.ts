import { openDB } from "idb";
import type { DBSchema } from "idb";
import { z } from "zod";

import type {
  DraftRecoveryScope,
  LocalDraftRecord,
} from "./draft-recovery-journal";

export const MAIL_CACHE_BUDGET = 100_000_000;
export const MAIL_CACHE_MAX_AGE = 30 * 24 * 60 * 60_000;

type CacheEntry = {
  key: string;
  bytes: number;
  accessedAt: number;
  expiresAt: number;
  userId: string;
};
type CacheOwner = { readonly sessionId: string; readonly epoch: string };
type RecoveryAuthority = { sessionId: string; epoch: string; slot: "current" };
const legacyRecoverySchema = z.object({
  editorId: z.string(),
  localId: z.string(),
  mailboxId: z.string(),
  payload: z.string(),
  updatedAt: z.number(),
  userId: z.string(),
});
const completeRecoveryMutation = async (
  guard: Promise<unknown>,
  pending: Promise<unknown>[]
) => {
  try {
    await Promise.all(pending);
  } catch (error) {
    try {
      await guard;
    } catch (guardError) {
      if (
        guardError instanceof DOMException &&
        guardError.name === "ConstraintError"
      ) {
        return;
      }
    }
    throw error;
  }
};
type MailCacheDatabase = {
  recoveryAuthority: {
    key: [string, string];
    value: RecoveryAuthority;
    indexes: { slot: string };
  };
  recovery: {
    key: [string, string, string, string, string];
    value: LocalDraftRecord;
    indexes: { userId: string; mailbox: [string, string] };
  };
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
      3,
      {
        blocking() {
          connection?.close();
          database = undefined;
        },
        terminated() {
          database = undefined;
        },
        upgrade(db, oldVersion, _version, tx) {
          if (oldVersion < 2) {
            db.createObjectStore("epochs");
          }
          const authority = db.createObjectStore("recoveryAuthority", {
            keyPath: ["sessionId", "epoch"],
          });
          // Stale primary keys conflict with the occupied slot and abort committed checkpoints.
          authority.createIndex("slot", "slot", { unique: true });
          void tx.objectStore("recoveryAuthority").put({
            epoch: crypto.randomUUID(),
            sessionId: "",
            slot: "current",
          });
          const recovery = db.createObjectStore("recovery", {
            keyPath: ["userId", "mailboxId", "editorId", "localId", "revision"],
          });
          recovery.createIndex("userId", "userId");
          recovery.createIndex("mailbox", ["userId", "mailboxId"]);
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
  let authenticatedOwner:
    | Readonly<{ sessionId: string; value: Promise<CacheOwner | null> }>
    | undefined;

  const changeUser = async (
    next: string | undefined,
    identity = next,
    force = false,
    cleanupOwner?: Promise<CacheOwner | null>,
    cleanupSession?: string
  ) => {
    if (!force && initialized && next === userId && identity === sessionId) {
      await initialization;
      return;
    }
    const previousUser = userId;
    const previousSession = sessionId;
    if (!cleanupOwner || cleanupSession === sessionId || userId === undefined) {
      initialized = true;
      userId = next;
      sessionId = identity;
      generation += 1;
      userGeneration += 1;
      protectedKeys.clear();
    }
    const previous = initialization;
    const transition = (async () => {
      await previous;
      const owner = await cleanupOwner;
      if (cleanupOwner && !owner) {
        return null;
      }
      const db = await open();
      const tx = db.transaction(
        ["entries", "values", "epochs", "recovery", "recoveryAuthority"],
        "readwrite"
      );
      void (async () => {
        try {
          await tx.done;
        } catch {
          /* Request failures below still propagate through transition. */
        }
      })();
      try {
        if (
          owner &&
          ((await tx.objectStore("epochs").get("session")) !== owner.epoch ||
            (await tx
              .objectStore("epochs")
              .get(`identity:${owner.sessionId}`)) !== "active")
        ) {
          await tx.done;
          return null;
        }
        const identityState = identity
          ? await tx.objectStore("epochs").get(`identity:${identity}`)
          : undefined;
        if (identity && identityState === "revoked") {
          databaseEpoch = undefined;
          await tx.done;
          return null;
        }
        const recoveryRevoked =
          identity !== undefined &&
          (await tx
            .objectStore("epochs")
            .get(`recovery-identity:${identity}`)) === "revoked";
        // Logout must commit even if another login has already changed local state.
        let revoked =
          next === undefined ||
          (identity !== undefined && identityState !== "active") ||
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
        let valueCursor = await tx.objectStore("values").openKeyCursor();
        while (valueCursor !== null) {
          if ((await tx.objectStore("entries").count(valueCursor.key)) === 0) {
            await tx.objectStore("values").delete(valueCursor.key);
          }
          valueCursor = await valueCursor.continue();
        }
        if (next === undefined) {
          await tx.objectStore("values").clear();
          await tx
            .objectStore("epochs")
            .put("consumed", "legacy-recovery-import");
        }
        let recoveryCursor = await tx.objectStore("recovery").openCursor();
        while (recoveryCursor) {
          if (recoveryCursor.value.userId !== next) {
            await recoveryCursor.delete();
          }
          recoveryCursor = await recoveryCursor.continue();
        }
        if (revoked) {
          for (const key of await tx.objectStore("epochs").getAllKeys()) {
            if (key.startsWith("identity:") && key !== `identity:${identity}`) {
              await tx.objectStore("epochs").put("revoked", key);
            }
            if (
              key.startsWith("recovery-identity:") &&
              key !== `recovery-identity:${identity}`
            ) {
              await tx.objectStore("epochs").put("revoked", key);
            }
          }
        }
        if (identity) {
          await tx.objectStore("epochs").put("active", `identity:${identity}`);
        }
        const epoch = revoked
          ? crypto.randomUUID()
          : ((await tx.objectStore("epochs").get("session")) ?? "");
        databaseEpoch = epoch;
        await tx.objectStore("epochs").put(epoch, "session");
        if (!recoveryRevoked) {
          await tx.objectStore("recoveryAuthority").clear();
          await tx.objectStore("recoveryAuthority").put({
            epoch,
            sessionId: identity ?? "",
            slot: "current",
          });
          if (identity) {
            await tx
              .objectStore("epochs")
              .put("active", `recovery-identity:${identity}`);
          }
        }
        await tx.done;
        if (next === undefined && typeof localStorage !== "undefined") {
          for (let index = localStorage.length - 1; index >= 0; index -= 1) {
            const key = localStorage.key(index);
            if (
              key?.startsWith("quieter:draft-recovery:") === true ||
              key?.startsWith("quieter:draft-recovery-v2:") === true
            ) {
              localStorage.removeItem(key);
            }
          }
        }
        return identity ? { epoch, sessionId: identity } : null;
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* Legacy removal can fail after the transaction commits. */
        }
        try {
          await tx.done;
        } catch {
          /* Preserve the original storage failure below. */
        }
        throw error;
      }
    })();
    if (next && identity) {
      authenticatedOwner = { sessionId: identity, value: transition };
    }
    initialization = (async () => {
      try {
        await transition;
      } catch {
        /* Normal initialization is optional. Explicit cleanup awaits transition. */
      }
    })();
    await transition;
  };

  const captureCleanup = () => {
    const owner = authenticatedOwner;
    return async () => {
      await changeUser(
        undefined,
        undefined,
        true,
        owner?.value ?? Promise.resolve(null),
        owner?.sessionId
      );
    };
  };
  const clearSession = async () => {
    await captureCleanup()();
  };

  return {
    captureCleanup,
    clearSession,
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
    recoverySession(nextUser: string, nextSession: string) {
      const activation = changeUser(nextUser, nextSession);
      const activationOwner = authenticatedOwner?.value;
      const localGeneration = userGeneration;
      let owner: CacheOwner | undefined;
      let detached = false;
      const ready = (async () => {
        await activation;
        const captured = await activationOwner;
        if (!captured || localGeneration !== userGeneration) {
          return false;
        }
        const db = await open();
        if (
          (await db.get("epochs", `recovery-identity:${nextSession}`)) !==
          "active"
        ) {
          return false;
        }
        owner = captured;
        return true;
      })();
      const list = async (
        scope: DraftRecoveryScope
      ): Promise<LocalDraftRecord[]> => {
        if (!owner) {
          await ready;
        }
        if (detached || scope.userId !== nextUser || !owner || !connection) {
          return [];
        }
        const tx = connection.transaction(
          ["recovery", "recoveryAuthority"],
          "readwrite"
        );
        const guard = tx
          .objectStore("recoveryAuthority")
          .put({ ...owner, slot: "current" });
        const completion = tx.done;
        void (async () => {
          try {
            await completion;
          } catch {
            /* The operation below reports transaction failure. */
          }
        })();
        try {
          await guard;
          const stored = await tx
            .objectStore("recovery")
            .index("mailbox")
            .getAll([scope.userId, scope.mailboxId]);
          const records = stored.toSorted(
            (left, right) => right.updatedAt - left.updatedAt
          );
          for (const record of records.slice(3)) {
            await tx
              .objectStore("recovery")
              .delete([
                record.userId,
                record.mailboxId,
                record.editorId,
                record.localId,
                record.revision,
              ]);
          }
          await completion;
          return detached || localGeneration !== userGeneration
            ? []
            : records.slice(0, 3);
        } catch (error) {
          let guardError: unknown;
          try {
            await guard;
          } catch (requestError) {
            guardError = requestError;
          }
          if (
            guardError instanceof DOMException &&
            guardError.name === "ConstraintError"
          ) {
            return [];
          }
          throw error;
        }
      };
      return {
        async clear() {
          detached = true;
          await (async () => {
            await ready;
            if (!owner || !connection) {
              return;
            }
            const tx = connection.transaction(
              ["recovery", "recoveryAuthority", "epochs"],
              "readwrite"
            );
            const guard = tx
              .objectStore("recoveryAuthority")
              .put({ ...owner, slot: "current" });
            void (async () => {
              try {
                await tx.done;
              } catch {
                /* The operation below reports transaction failure. */
              }
            })();
            try {
              await guard;
              await tx
                .objectStore("epochs")
                .put("consumed", "legacy-recovery-import");
              await tx
                .objectStore("epochs")
                .put("revoked", `recovery-identity:${owner.sessionId}`);
              await tx.objectStore("recovery").clear();
              await tx.objectStore("recoveryAuthority").clear();
              await tx.objectStore("recoveryAuthority").put({
                epoch: crypto.randomUUID(),
                sessionId: "",
                slot: "current",
              });
              await tx.done;
              for (
                let index = localStorage.length - 1;
                index >= 0;
                index -= 1
              ) {
                const key = localStorage.key(index);
                if (
                  key?.startsWith("quieter:draft-recovery:") === true ||
                  key?.startsWith("quieter:draft-recovery-v2:") === true
                ) {
                  localStorage.removeItem(key);
                }
              }
            } catch (error) {
              try {
                tx.abort();
              } catch {
                /* The failing transaction may already be aborted. */
              }
              let guardError: unknown;
              try {
                await guard;
              } catch (requestError) {
                guardError = requestError;
              }
              if (
                guardError instanceof DOMException &&
                guardError.name === "ConstraintError"
              ) {
                return;
              }
              throw error;
            }
          })();
        },
        detach() {
          detached = true;
        },
        list,
        async migrateLegacy() {
          await ready;
          if (!owner || !connection || detached) {
            return;
          }
          const tx = connection.transaction(
            ["recovery", "recoveryAuthority", "epochs"],
            "readwrite"
          );
          const guard = tx
            .objectStore("recoveryAuthority")
            .put({ ...owner, slot: "current" });
          void (async () => {
            try {
              await tx.done;
            } catch {
              /* The operation below reports transaction failure. */
            }
          })();
          try {
            await guard;
            const importing =
              (await tx.objectStore("epochs").get("legacy-recovery-import")) !==
              "consumed";
            const migratedKeys: string[] = [];
            for (let index = localStorage.length - 1; index >= 0; index -= 1) {
              const key = localStorage.key(index);
              if (key?.startsWith("quieter:draft-recovery:") === true) {
                migratedKeys.push(key);
              } else if (
                key?.startsWith("quieter:draft-recovery-v2:") === true
              ) {
                let records: unknown = null;
                let legacyScope: unknown = null;
                try {
                  if (importing) {
                    records = JSON.parse(localStorage.getItem(key) ?? "null");
                    legacyScope = JSON.parse(
                      key.slice("quieter:draft-recovery-v2:".length)
                    );
                  }
                } catch {
                  records = null;
                }
                if (Array.isArray(records) && Array.isArray(legacyScope)) {
                  for (const value of records) {
                    const parsed = legacyRecoverySchema.safeParse(value);
                    if (
                      parsed.success &&
                      parsed.data.userId === nextUser &&
                      legacyScope[0] === nextUser &&
                      legacyScope[1] === parsed.data.mailboxId
                    ) {
                      const record = parsed.data;
                      const existing = await tx
                        .objectStore("recovery")
                        .getAllKeys(
                          IDBKeyRange.bound(
                            [
                              record.userId,
                              record.mailboxId,
                              record.editorId,
                              record.localId,
                              "",
                            ],
                            [
                              record.userId,
                              record.mailboxId,
                              record.editorId,
                              record.localId,
                              "\uFFFF",
                            ]
                          )
                        );
                      if (existing.length === 0) {
                        await tx
                          .objectStore("recovery")
                          .put({ ...record, revision: crypto.randomUUID() });
                      }
                    }
                  }
                }
                migratedKeys.push(key);
              }
            }
            await tx
              .objectStore("epochs")
              .put("consumed", "legacy-recovery-import");
            const byMailbox = new Map<string, LocalDraftRecord[]>();
            for (const record of await tx.objectStore("recovery").getAll()) {
              const records = byMailbox.get(record.mailboxId) ?? [];
              records.push(record);
              byMailbox.set(record.mailboxId, records);
            }
            for (const records of byMailbox.values()) {
              for (const record of records
                .toSorted((left, right) => right.updatedAt - left.updatedAt)
                .slice(3)) {
                await tx
                  .objectStore("recovery")
                  .delete([
                    record.userId,
                    record.mailboxId,
                    record.editorId,
                    record.localId,
                    record.revision,
                  ]);
              }
            }
            await tx.done;
            for (const key of migratedKeys) {
              localStorage.removeItem(key);
            }
          } catch (error) {
            try {
              tx.abort();
            } catch {
              /* The failing transaction may already be aborted. */
            }
            let guardError: unknown;
            try {
              await guard;
            } catch (requestError) {
              guardError = requestError;
            }
            if (
              guardError instanceof DOMException &&
              guardError.name === "ConstraintError"
            ) {
              return;
            }
            throw error;
          }
        },
        ready,
        async remove(
          record: Pick<
            LocalDraftRecord,
            "userId" | "mailboxId" | "editorId" | "localId"
          > & { revision?: string }
        ) {
          if (
            detached ||
            localGeneration !== userGeneration ||
            record.userId !== nextUser ||
            !owner ||
            !connection
          ) {
            return;
          }
          const tx = connection.transaction(
            ["recovery", "recoveryAuthority"],
            "readwrite"
          );
          const pending: Promise<unknown>[] = [tx.done];
          try {
            const guard = tx
              .objectStore("recoveryAuthority")
              .put({ ...owner, slot: "current" });
            pending.push(guard);
            const removed = tx
              .objectStore("recovery")
              .delete(
                record.revision === undefined
                  ? IDBKeyRange.bound(
                      [
                        record.userId,
                        record.mailboxId,
                        record.editorId,
                        record.localId,
                        "",
                      ],
                      [
                        record.userId,
                        record.mailboxId,
                        record.editorId,
                        record.localId,
                        "\uFFFF",
                      ]
                    )
                  : [
                      record.userId,
                      record.mailboxId,
                      record.editorId,
                      record.localId,
                      record.revision,
                    ]
              );
            pending.push(removed);
            tx.commit();
            await completeRecoveryMutation(guard, pending);
          } catch (error) {
            try {
              tx.abort();
            } catch {
              /* The transaction may already be finished. */
            }
            await Promise.allSettled(pending);
            throw error;
          }
        },
        async save(record: Omit<LocalDraftRecord, "revision">) {
          if (
            detached ||
            localGeneration !== userGeneration ||
            record.userId !== nextUser ||
            !owner ||
            !connection
          ) {
            return;
          }
          const saved = { ...record, revision: crypto.randomUUID() };
          const tx = connection.transaction(
            ["recovery", "recoveryAuthority"],
            "readwrite"
          );
          const pending: Promise<unknown>[] = [tx.done];
          try {
            const guard = tx
              .objectStore("recoveryAuthority")
              .put({ ...owner, slot: "current" });
            pending.push(guard);
            const removed = tx
              .objectStore("recovery")
              .delete(
                IDBKeyRange.bound(
                  [
                    record.userId,
                    record.mailboxId,
                    record.editorId,
                    record.localId,
                    "",
                  ],
                  [
                    record.userId,
                    record.mailboxId,
                    record.editorId,
                    record.localId,
                    "\uFFFF",
                  ]
                )
              );
            pending.push(removed);
            const written = tx.objectStore("recovery").put(saved);
            pending.push(written);
            // Queue the complete checkpoint before pagehide can terminate this context.
            tx.commit();
            const pruning = list(record);
            pending.push(pruning);
            await completeRecoveryMutation(guard, pending);
          } catch (error) {
            try {
              tx.abort();
            } catch {
              /* The transaction may already be finished. */
            }
            await Promise.allSettled(pending);
            throw error;
          }
        },
      };
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
        if (next === undefined) {
          await clearSession();
        } else {
          await changeUser(next, identity);
        }
      } catch {
        /* The browser may deny optional persistence. */
      }
    },
  };
};

export const mailCache = createMailCache();
