import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { db, withRequestDatabaseClient } from "../src/client";

const state = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
}));
vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      DATABASE_URL: state.databaseUrl,
      QUIETER_DEPLOYMENT_ENV: "local" as const,
    },
  };
});

describe.skipIf(state.databaseUrl === undefined)(
  "Node database lifecycle",
  () => {
    beforeAll(() => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Database lifecycle tests require loopback quieter_migration_test."
        );
      }
    });

    afterAll(async () => {
      await db.$client.end();
    });

    test("bounds connections across sequential, nested and concurrent requests", async () => {
      const pids = new Set<number>();
      for (let index = 0; index < 20; index += 1) {
        // oxlint-disable-next-line no-await-in-loop -- Exercise successive requests, separately from concurrent requests below.
        const rows = await withRequestDatabaseClient(
          async () =>
            await withRequestDatabaseClient(
              async () =>
                await db.$client<
                  { pid: number }[]
                >`select pg_backend_pid() as pid`
            )
        );
        pids.add(rows[0]?.pid ?? -1);
      }
      const concurrent = await Promise.all(
        Array.from(
          { length: 8 },
          async () =>
            await withRequestDatabaseClient(
              async () =>
                await db.$client<
                  { pid: number }[]
                >`select pg_backend_pid() as pid, pg_sleep(0.01)`
            )
        )
      );
      for (const rows of concurrent) {
        pids.add(rows[0]?.pid ?? -1);
      }
      expect(pids.size).toBe(1);
      expect(pids.has(-1)).toBeFalsy();
    });

    test("keeps streamed database work usable after returning the response", async () => {
      // oxlint-disable-next-line typescript/no-invalid-void-type -- Completion-only promise; void is a valid generic argument here.
      const ready = Promise.withResolvers<void>();
      const response = await withRequestDatabaseClient(
        () =>
          new Response(
            new ReadableStream({
              async start(controller) {
                await ready.promise;
                const rows = await db.$client<
                  { value: number }[]
                >`select 42 as value`;
                controller.enqueue(
                  new TextEncoder().encode(String(rows[0]?.value))
                );
                controller.close();
              },
            })
          )
      );
      ready.resolve();
      await expect(response.text()).resolves.toBe("42");
    });
  }
);
