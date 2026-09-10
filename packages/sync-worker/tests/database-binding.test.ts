import {
  assertDatabaseConfigured,
  withRequestDatabaseClient,
} from "@quieter/database/client";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";

describe("Durable Object database bindings", () => {
  it("loads Hyperdrive inside a cold and hibernated Durable Object without a Worker fetch", async () => {
    const object = env.UserSyncObjects.getByName(crypto.randomUUID());
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await runInDurableObject(object, async () => {
        expect(assertDatabaseConfigured).not.toThrow();
        await withRequestDatabaseClient(async (client) => {
          await withRequestDatabaseClient((nested) => {
            expect(nested).toBe(client);
          });
        });
      });
      await evictDurableObject(object);
    }
  });
});
