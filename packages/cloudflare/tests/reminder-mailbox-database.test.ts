import { assertDatabaseConfigured } from "@quieter/database/client";
import { configureServerEnv } from "@quieter/env/server";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vite-plus/test";

describe("reminder mailbox database binding", () => {
  test("reads the linked database binding inside a cold durable object", async () => {
    const stub = env.ReminderMailbox.get(
      env.ReminderMailbox.idFromName(crypto.randomUUID())
    );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await runInDurableObject(stub, () => {
        configureServerEnv({
          DATABASE_URL: undefined,
          QUIETER_DEPLOYMENT_ENV: "production",
        });
        expect(() => {
          assertDatabaseConfigured();
        }).not.toThrow();
      });
      await evictDurableObject(stub);
    }
  });
});
