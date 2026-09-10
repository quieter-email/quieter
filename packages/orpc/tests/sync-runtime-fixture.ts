/* oxlint-disable eslint/require-await -- In-memory storage implements the asynchronous runtime boundary. */
import type { SyncDelivery } from "@quieter/sync-server";
import { aroundEach, vi } from "vite-plus/test";

import { withMailSyncRuntime } from "../src/mail-sync-runtime";

const bodies = new Map<string, Uint8Array>();
aroundEach(async (runTest) => {
  await withMailSyncRuntime(
    {
      bodies: {
        delete: async (key) => {
          bodies.delete(key);
        },
        get: async (key) => bodies.get(key) ?? null,
        has: async (key) => bodies.has(key),
        put: async (key, bytes) => {
          bodies.set(key, new Uint8Array(bytes));
        },
      },
      deliver: vi.fn<SyncDelivery>().mockResolvedValue(),
      enqueue: vi
        .fn<(mailboxId: string) => Promise<void>>()
        .mockResolvedValue(),
    },
    runTest
  );
});
