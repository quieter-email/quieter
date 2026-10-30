import "fake-indexeddb/auto";
import {
  createMailCache,
  MAIL_CACHE_MAX_AGE,
} from "@quieter/app/lib/mail-cache";
import { openDB } from "idb";
import { describe, expect, test, vi } from "vite-plus/test";

describe("bounded mail cache", () => {
  test("only issues cleanup authority after an observed activation", async () => {
    const cache = createMailCache({ name: crypto.randomUUID() });
    expect(cache.captureCleanup()).toBeUndefined();
    const open = vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new Error("storage denied");
    });
    try {
      await cache.setUser("one", "observed");
      const cleanup = cache.captureCleanup();
      expect(cleanup).toBeTypeOf("function");
      await expect(cleanup?.isCurrent()).rejects.toThrow(/denied/u);
      await expect(cleanup?.()).rejects.toThrow(/denied/u);
    } finally {
      open.mockRestore();
    }
  });

  test("a rejected authority replacement leaves the occupied guard intact", async () => {
    const name = crypto.randomUUID();
    const cache = createMailCache({ name });
    await cache.setUser("one", "current");
    await cache.setItem("body-message", "Private body");
    const sibling = createMailCache({ name });
    await sibling.setUser("one", "current");
    // oxlint-disable-next-line typescript/unbound-method -- Invoked with its original object store below.
    const original = IDBObjectStore.prototype.put;
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function put(
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey
      ) {
        if (this.name === "recoveryAuthority") {
          throw new Error("authority storage denied");
        }
        return original.call(this, value, key);
      });
    try {
      await expect(cache.captureCleanup()?.()).rejects.toThrow(/denied/u);
    } finally {
      put.mockRestore();
    }
    const db = await openDB(name);
    await expect(db.getAll("recoveryAuthority")).resolves.toMatchObject([
      { sessionId: "current" },
    ]);
    await expect(db.getAll("values")).resolves.toContain("Private body");
    await expect(sibling.getItem("body-message")).resolves.toBe("Private body");
    await cache.setItem("body-message", "Forbidden local write");
    await expect(cache.getItem("body-message")).resolves.toBeNull();
    db.close();
  });

  test.each(["one", "two"])(
    "drops unindexed private values on %s activation and retains valid same-user bodies",
    async (nextUser) => {
      const name = crypto.randomUUID();
      const cache = createMailCache({ name });
      await cache.setUser("one", "old");
      await cache.setItem("body-message", "Valid private body");
      const db = await openDB(name);
      await db.put("values", "Orphan private body", "orphan");
      const fresh = createMailCache({ name });
      await fresh.setUser(nextUser, "fresh");
      await expect(db.getAll("values")).resolves.not.toContain(
        "Orphan private body"
      );
      await expect(fresh.getItem("body-message")).resolves.toBe(
        nextUser === "one" ? "Valid private body" : null
      );
      const reload = createMailCache({ name });
      await reload.setUser(nextUser, "fresh");
      await expect(reload.getItem("body-message")).resolves.toBe(
        nextUser === "one" ? "Valid private body" : null
      );
      db.close();
    }
  );

  test.each(["same", "fresh"])(
    "captured cleanup fences a %s local rebind without revoking a fresh activation",
    async (binding) => {
      const name = crypto.randomUUID();
      const cache = createMailCache({ name });
      await cache.setUser("one", "same");
      const cleanup = cache.captureCleanup();
      cache.detach();
      await cache.setUser("one", binding);
      await cache.setItem("body-message", "bound private body");
      await expect(cleanup?.isCurrent()).resolves.toBe(binding === "same");
      await cleanup?.();
      await cache.setItem("body-message", "late write");
      await expect(cache.getItem("body-message")).resolves.toBe(
        binding === "same" ? null : "late write"
      );
      const reload = createMailCache({ name });
      await reload.setUser("one", binding);
      await expect(reload.getItem("body-message")).resolves.toBe(
        binding === "same" ? null : "late write"
      );
    }
  );

  test.each([
    ["one", false],
    ["one", true],
    ["two", false],
    ["two", true],
  ] as const)(
    "passive cleanup preserves a newer %s identity after detach: %s",
    async (nextUser, detached) => {
      const name = crypto.randomUUID();
      const old = createMailCache({ name });
      const fresh = createMailCache({ name });
      const pending = old.setUser("one", "old");
      if (detached) {
        old.detach();
      }
      await pending;
      await fresh.setUser(nextUser, "fresh");
      await fresh.setItem("body-current", "fresh private body");
      await old.clearSession();
      await old.setUser(undefined);
      await old.setItem("body-current", "stale write");
      await expect(old.getItem("body-current")).resolves.toBeNull();
      await expect(fresh.getItem("body-current")).resolves.toBe(
        "fresh private body"
      );
      const reload = createMailCache({ name });
      await reload.setUser(nextUser, "fresh");
      await expect(reload.getItem("body-current")).resolves.toBe(
        "fresh private body"
      );
      await reload.setItem("body-next", "new write");
      await expect(fresh.getItem("body-next")).resolves.toBe("new write");
      await old.setUser("one", "old");
      await expect(old.getItem("body-current")).resolves.toBeNull();
    }
  );

  test("an anonymous tab cannot purge an authenticated tab", async () => {
    const name = crypto.randomUUID();
    const owner = createMailCache({ name });
    await owner.setUser("one", "session");
    await owner.setItem("body-current", "private body");
    const anonymous = createMailCache({ name });
    await anonymous.clearSession();
    await anonymous.setUser(undefined);
    await expect(owner.getItem("body-current")).resolves.toBe("private body");
  });

  test("passive cleanup captures an activation still initializing", async () => {
    const name = crypto.randomUUID();
    const cache = createMailCache({ name });
    const initializing = cache.setUser("one", "expired");
    const cleanup = cache.clearSession();
    await initializing;
    await cleanup;
    const reload = createMailCache({ name });
    await reload.setUser("one", "expired");
    await reload.setItem("body-current", "stale write");
    await expect(reload.getItem("body-current")).resolves.toBeNull();
  });

  test("passive cleanup reports a denied purge while fencing local writes", async () => {
    const cache = createMailCache({ name: crypto.randomUUID() });
    await cache.setUser("one", "expired");
    await cache.setItem("body-current", "private body");
    const clear = vi
      .spyOn(IDBObjectStore.prototype, "clear")
      .mockImplementationOnce(() => {
        throw new Error("storage denied");
      });
    try {
      await expect(cache.clearSession()).rejects.toThrow(/storage denied/u);
      await cache.setItem("body-current", "stale write");
      await expect(cache.getItem("body-current")).resolves.toBeNull();
    } finally {
      clear.mockRestore();
    }
  });

  test("passive expiry purges raw orphan bodies and rejects the expired session", async () => {
    const name = crypto.randomUUID();
    const cache = createMailCache({ name });
    void cache.setUser("one", "expired");
    await cache.setItem("quieter-cache-query", "metadata");
    await cache.setItem("body-current", "private body");
    const db = await openDB(name);
    await db.put("values", "orphan private body", "orphan");
    await cache.clearSession();
    await expect(db.getAll("entries")).resolves.toHaveLength(0);
    await expect(db.getAll("values")).resolves.toHaveLength(0);
    await cache.setUser("one", "expired");
    await cache.setItem("body-current", "stale write");
    await expect(cache.getItem("body-current")).resolves.toBeNull();
    db.close();
  });

  test("enumerates query metadata without loading bodies", async () => {
    const cache = createMailCache({ name: crypto.randomUUID() });
    void cache.setUser("one");
    await cache.setItem("quieter-cache-query", "metadata");
    await cache.setItem("body-message", "body");
    await expect(cache.entries()).resolves.toStrictEqual([
      ["quieter-cache-query", "metadata"],
    ]);
    await expect(cache.getItem("body-message")).resolves.toBe("body");
  });

  test("evicts the least recently opened entry and admits new mail", async () => {
    let time = 1;
    const cache = createMailCache({
      budget: 1800,
      name: crypto.randomUUID(),
      now: () => {
        time += 1;
        return time;
      },
    });
    void cache.setUser("one");
    await cache.setItem("a", "a".repeat(300));
    await cache.setItem("b", "b".repeat(300));
    await cache.setItem("c", "c".repeat(300));
    await cache.getItem("a");
    await cache.setItem("d", "d".repeat(300));
    await expect(cache.getItem("b")).resolves.toBeNull();
    await expect(cache.getItem("a")).resolves.toBe("a".repeat(300));
    await expect(cache.getItem("d")).resolves.toBe("d".repeat(300));
  });

  test("protects an open thread and discards expired entries", async () => {
    let time = 1;
    const cache = createMailCache({
      budget: 1200,
      name: crypto.randomUUID(),
      now: () => {
        time += 1;
        return time;
      },
    });
    void cache.setUser("one");
    await cache.setItem("open", "a".repeat(300));
    cache.protect("open", true);
    await cache.setItem("old", "b".repeat(300));
    await cache.setItem("new", "c".repeat(300));
    await expect(cache.getItem("open")).resolves.not.toBeNull();
    await expect(cache.getItem("old")).resolves.toBeNull();
    time += MAIL_CACHE_MAX_AGE;
    await expect(cache.getItem("open")).resolves.toBeNull();
  });

  test("fences writes when the account changes and clears on logout", async () => {
    const cache = createMailCache({ name: crypto.randomUUID() });
    void cache.setUser("one");
    const staleWrite = cache.setItem("message", "private");
    void cache.setUser("two");
    await staleWrite;
    await expect(cache.getItem("message")).resolves.toBeNull();
    await cache.setItem("message", "second account");
    void cache.setUser(undefined);
    void cache.setUser("one");
    await expect(cache.getItem("message")).resolves.toBeNull();
  });

  test.each(["one", "two"])(
    "detaches a revoked tab without revoking the fresh %s login",
    async (nextUser) => {
      const name = crypto.randomUUID();
      const stale = createMailCache({ name });
      const sender = createMailCache({ name });
      await stale.setUser("one", "old-session");
      await sender.setUser("one", "old-session");
      await stale.setItem("body-old", "old private body");
      await sender.clearSession();
      await sender.setUser(nextUser, "fresh-session");
      await sender.setItem("body-fresh", "fresh private body");

      stale.detach();
      stale.detach();
      await stale.setItem("body-fresh", "stale private body");
      await expect(stale.getItem("body-fresh")).resolves.toBeNull();
      await expect(sender.getItem("body-fresh")).resolves.toBe(
        "fresh private body"
      );
      await sender.setItem("body-after", "fresh write");
      const reload = createMailCache({ name });
      await reload.setUser(nextUser, "fresh-session");
      await expect(reload.getItem("body-after")).resolves.toBe("fresh write");
      await stale.setUser("one", "old-session");
      await stale.setItem("body-old", "revoked private body");
      await expect(stale.getItem("body-old")).resolves.toBeNull();
      await expect(reload.getItem("body-old")).resolves.toBeNull();
    }
  );

  test("preserves pending initialization ordering across local detach", async () => {
    const name = crypto.randomUUID();
    const cache = createMailCache({ name });
    const initializing = cache.setUser("one", "old-session");
    const staleWrite = cache.setItem("body-old", "stale private body");
    cache.detach();
    const login = cache.setUser("one", "fresh-session");
    await Promise.all([initializing, staleWrite, login]);
    await expect(cache.getItem("body-old")).resolves.toBeNull();
    await cache.setItem("body-fresh", "fresh private body");
    const reload = createMailCache({ name });
    await reload.setUser("one", "fresh-session");
    await expect(reload.getItem("body-fresh")).resolves.toBe(
      "fresh private body"
    );
  });

  test("concurrent account and calendar removals purge each scope and retain other calendars", async () => {
    const cache = createMailCache({ name: crypto.randomUUID() });
    void cache.setUser("one");
    const first = `quieter-cache-${JSON.stringify(["calendar", "one", "connection", "first", "calendars"])}`;
    const second = `quieter-cache-${JSON.stringify(["calendar", "one", "connection", "second", "calendars"])}`;
    const work = `quieter-cache-${JSON.stringify(["calendar", "one", "connection", "retained", "calendar", "work", "event", "meeting"])}`;
    const personal = `quieter-cache-${JSON.stringify(["calendar", "one", "connection", "retained", "calendar", "personal", "event", "appointment"])}`;
    const holiday = `quieter-cache-${JSON.stringify(["calendar", "one", "connection", "retained", "calendar", "holidays", "event", "holiday"])}`;
    for (const key of [first, second, work, personal, holiday]) {
      await cache.setItem(key, "Private schedule");
    }
    await Promise.all([
      cache.removeCalendarScope("first"),
      cache.removeCalendarScope("second"),
      cache.removeCalendarScope("retained", "work"),
      cache.removeCalendarScope("retained", "personal"),
    ]);
    for (const key of [first, second, work, personal]) {
      await expect(cache.getItem(key)).resolves.toBeNull();
    }
    await expect(cache.getItem(holiday)).resolves.toBe("Private schedule");
  });

  test("evicts and retries a browser quota failure", async () => {
    const cache = createMailCache({ budget: 3000, name: crypto.randomUUID() });
    void cache.setUser("one");
    await cache.setItem("old", "a".repeat(300));
    // oxlint-disable-next-line typescript/unbound-method -- Invoked below with the original object store as this.
    const original = IDBObjectStore.prototype.put;
    let rejected = false;
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function put(
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey
      ) {
        if (this.name === "values" && !rejected) {
          rejected = true;
          throw new DOMException("full", "QuotaExceededError");
        }
        return original.call(this, value, key);
      });
    try {
      await cache.setItem("new", "b".repeat(300));
      await expect(cache.getItem("new")).resolves.toBe("b".repeat(300));
      await expect(cache.getItem("old")).resolves.toBeNull();
    } finally {
      put.mockRestore();
    }
  });
});

describe("sign-out cache isolation", () => {
  test("does not retain private bodies across rapid sign-out and same-user login", async () => {
    const cache = createMailCache({ name: crypto.randomUUID() });
    void cache.setUser("one");
    await cache.setItem("body-message", "private");
    const cleared = cache.setUser(undefined);
    void cache.setUser("one");
    await cleared;
    await expect(cache.getItem("body-message")).resolves.toBeNull();
  });

  test("prevents a signed-out sibling from restoring private bodies", async () => {
    const name = crypto.randomUUID();
    const first = createMailCache({ name });
    const sibling = createMailCache({ name });
    void first.setUser("one");
    void sibling.setUser("one");
    await first.setItem("body-message", "private");
    await sibling.getItem("body-message");
    await first.setUser(undefined);
    await sibling.setItem("body-message", "late private body");
    void first.setUser("one");
    await expect(first.getItem("body-message")).resolves.toBeNull();
  });
});

describe("durable cache revocation", () => {
  test("rejects delayed initialization from a revoked session and admits a fresh login", async () => {
    const name = crypto.randomUUID();
    const original = createMailCache({ name });
    await original.setUser("one", "old-session");
    await original.setItem("body-message", "private");
    await original.clearSession();
    const stale = createMailCache({ name });
    await stale.setUser("one", "old-session");
    await stale.setItem("body-message", "stale private body");
    const login = createMailCache({ name });
    await login.setUser("one", "new-session");
    await expect(login.getItem("body-message")).resolves.toBeNull();
    await login.setItem("body-message", "new session body");
    const reload = createMailCache({ name });
    await reload.setUser("one", "new-session");
    await expect(reload.getItem("body-message")).resolves.toBe(
      "new session body"
    );
    await expect(stale.getItem("body-message")).resolves.toBeNull();
  });

  test("awaits removal of both raw stores including unindexed body records", async () => {
    const name = crypto.randomUUID();
    const cache = createMailCache({ name });
    await cache.setUser("one");
    await cache.setItem("body-message", "private");
    await cache.setItem("quieter-cache-query", "private metadata");
    const db = await openDB(name);
    await db.put("values", "unindexed private body", "orphan");
    await cache.clearSession();
    for (const store of ["values", "entries"]) {
      const values = await db.getAll(store);
      expect(values).toHaveLength(0);
    }
    db.close();
  });
});
