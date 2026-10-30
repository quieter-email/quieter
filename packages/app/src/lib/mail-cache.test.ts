import "fake-indexeddb/auto";
import {
  createMailCache,
  MAIL_CACHE_MAX_AGE,
} from "@quieter/app/lib/mail-cache";
import { openDB } from "idb";
import { describe, expect, test, vi } from "vite-plus/test";

describe("bounded mail cache", () => {
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
    await original.clear();
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
    await cache.clear();
    for (const store of ["values", "entries"]) {
      const values = await db.getAll(store);
      expect(values).toHaveLength(0);
    }
    db.close();
  });
});
