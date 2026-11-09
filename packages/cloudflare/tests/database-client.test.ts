import { db, withRequestDatabaseClient } from "@quieter/database/client";
import { describe, expect, test, vi } from "vite-plus/test";

// These tests supply a loopback URL. Hide the worker Hyperdrive proxy so the
// local development guard keeps validating that URL.
vi.mock(import("sst/resource"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    Resource: new Proxy(actual.Resource, {
      get(target, property): unknown {
        return property === "AppDatabaseV2"
          ? undefined
          : Reflect.get(target, property);
      },
    }),
  };
});

vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      DATABASE_URL: "postgresql://test:test@localhost:5432/quieter_dev",
      QUIETER_DEPLOYMENT_ENV: "local" as const,
    },
  };
});

describe("Worker database scope", () => {
  test("keeps the request client inside deferred stream callbacks", async () => {
    const { promise, resolve } = Promise.withResolvers<null>();
    const response = await withRequestDatabaseClient(async (client) => {
      await Promise.resolve();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          await promise;
          controller.enqueue(new TextEncoder().encode("response"));
          controller.close();
        },
      }).pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          async transform(chunk, controller) {
            await Promise.resolve();
            expect(db.$client).toBe(client.$client);
            controller.enqueue(chunk);
          },
        })
      );
      return new Response(stream);
    });
    expect(() => db.$client).toThrow("requires withRequestDatabaseClient");
    resolve(null);
    await expect(response.text()).resolves.toBe("response");
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
