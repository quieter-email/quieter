import "fake-indexeddb/auto";
import { describe, expect, test, vi } from "vite-plus/test";

import { createMailCache, MAIL_CACHE_MAX_AGE } from "./mail-cache";

describe("bounded mail cache", () => {
  test("enumerates query metadata without loading bodies", async () => {
    const cache = createMailCache({ name: crypto.randomUUID() });
    cache.setUser("one");
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
    cache.setUser("one");
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
    cache.setUser("one");
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
    cache.setUser("one");
    const staleWrite = cache.setItem("message", "private");
    cache.setUser("two");
    await staleWrite;
    await expect(cache.getItem("message")).resolves.toBeNull();
    await cache.setItem("message", "second account");
    cache.setUser(undefined);
    cache.setUser("one");
    await expect(cache.getItem("message")).resolves.toBeNull();
  });

  test("evicts and retries a browser quota failure", async () => {
    const cache = createMailCache({ budget: 3000, name: crypto.randomUUID() });
    cache.setUser("one");
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
