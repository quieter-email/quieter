import { db, withRequestDatabaseClient } from "@quieter/database/client";
import { describe, expect, test, vi } from "vite-plus/test";

vi.mock(import("@quieter/env/server"), async (original) => {
  const { env } = await import("cloudflare:workers");
  const actual = await original();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      DATABASE_URL: env.AppDatabaseV2.connectionString,
      QUIETER_DEPLOYMENT_ENV: "local" as const,
    },
  };
});

describe("Worker database scope", () => {
  test("rejects unscoped access in the native Worker runtime", () => {
    expect(() => db.$client).toThrow("requires withRequestDatabaseClient");
  });

  test("isolates concurrent request clients and preserves nested scopes", async () => {
    // oxlint-disable-next-line typescript/no-invalid-void-type -- Completion-only promise; void is a valid generic argument here.
    const ready = Promise.withResolvers<void>();
    const first = withRequestDatabaseClient(async (client) => {
      ready.resolve();
      await withRequestDatabaseClient(async (nested) => {
        await Promise.resolve();
        expect(nested).toBe(client);
        expect(db.$client).toBe(client.$client);
      });
      return client;
    });
    const second = withRequestDatabaseClient(async (client) => {
      await ready.promise;
      expect(db.$client).toBe(client.$client);
      return client;
    });
    const clients = await Promise.all([first, second]);
    expect(clients[0]).not.toBe(clients[1]);
    expect(() => db.$client).toThrow("requires withRequestDatabaseClient");
  });
});
