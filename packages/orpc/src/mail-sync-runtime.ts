import { AsyncLocalStorage } from "node:async_hooks";

import { db } from "@quieter/database/client";
import type { DatabaseTransaction } from "@quieter/database/client";
import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";
import type { SyncBody } from "@quieter/sync";
import { SyncRepository } from "@quieter/sync-server";
import type { SyncDelivery } from "@quieter/sync-server";
import { encodeSyncBody } from "@quieter/sync-server/body-store";
import type { SyncBodyStore } from "@quieter/sync-server/body-store";
import { projectManagedMailbox } from "@quieter/sync-server/managed";
import type { ManagedSyncSelection } from "@quieter/sync-server/managed";

type SyncRuntime = {
  deliver: SyncDelivery;
  bodies: SyncBodyStore;
  enqueue: (mailboxId: string) => Promise<void>;
};
const syncRuntime = new AsyncLocalStorage<SyncRuntime>();

export const withMailSyncRuntime = async <Result>(
  runtime: SyncRuntime,
  run: () => Promise<Result>
) => await syncRuntime.run(runtime, run);

export const getMailSyncConfiguration = () => {
  if (serverEnv.QUIETER_MAIL_SYNC_ENABLED !== true) {
    return null;
  }
  const url = serverEnv.MAIL_SYNC_URL;
  const secret = serverEnv.MAIL_SYNC_SECRET;
  if (!url || !secret || secret.length < 32) {
    throw new Error("Mail sync URL and signing secret must be configured.");
  }
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" &&
    !(
      serverEnv.QUIETER_DEPLOYMENT_ENV === "local" &&
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    )
  ) {
    throw new Error("Mail sync requires HTTPS outside loopback development.");
  }
  return { secret, url: parsed };
};

const requestSyncRuntime = async (path: string, init: RequestInit = {}) => {
  const configuration = getMailSyncConfiguration();
  if (configuration === null) {
    throw new Error("Mail sync is unavailable.");
  }
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${configuration.secret}`);
  const response = await fetch(new URL(path, configuration.url), {
    ...init,
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error("Mail sync delivery is temporarily unavailable.");
  }
  return response;
};

export const mailSyncServices = () => {
  const runtime = syncRuntime.getStore();
  const deliver: SyncDelivery =
    runtime?.deliver ??
    (async (batch) => {
      const response = await requestSyncRuntime("/internal/batch", {
        body: JSON.stringify(batch),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Mail sync delivery is unavailable.");
      }
    });
  const bodies: SyncBodyStore = runtime?.bodies ?? {
    delete: async (key) => {
      await requestSyncRuntime(
        `/internal/body?key=${encodeURIComponent(key)}`,
        { method: "DELETE" }
      );
    },
    get: async (key) => {
      const response = await requestSyncRuntime(
        `/internal/body?key=${encodeURIComponent(key)}`
      );
      return response.status === 404
        ? null
        : new Uint8Array(await response.arrayBuffer());
    },
    put: async (key, bytes) => {
      const response = await requestSyncRuntime(
        `/internal/body?key=${encodeURIComponent(key)}`,
        { body: new Blob([new Uint8Array(bytes)]), method: "PUT" }
      );
      if (!response.ok) {
        throw new Error("Message content could not be stored.");
      }
    },
  };
  const enqueue =
    runtime?.enqueue ??
    (async (mailboxId: string) => {
      const response = await requestSyncRuntime("/internal/synchronize", {
        body: JSON.stringify({ mailboxId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Mail synchronization could not be scheduled.");
      }
    });
  return {
    bodies,
    enqueue,
    repository: new SyncRepository(db, deliver, (error) => {
      reportError(error, { operation: "mail_sync_delivery" });
    }),
  };
};

export const withManagedSyncTransaction = async <Result>(
  mailboxId: string,
  selection:
    | ManagedSyncSelection
    | ((result: NoInfer<Result>) => ManagedSyncSelection),
  run: (database: DatabaseTransaction) => Promise<Result>
): Promise<Result> => {
  if (getMailSyncConfiguration() === null) {
    return await db.transaction(run);
  }
  const { repository } = mailSyncServices();
  return await repository.transaction(mailboxId, async (context) => {
    const result = await run(context.database);
    await projectManagedMailbox(
      context,
      typeof selection === "function" ? selection(result) : selection
    );
    return result;
  });
};

export const storeManagedSyncBody = async (
  mailboxId: string,
  body: SyncBody
) => {
  if (getMailSyncConfiguration() === null) {
    return;
  }
  const encoded = encodeSyncBody(body);
  await mailSyncServices().bodies.put(
    `sync/bodies/${encodeURIComponent(mailboxId)}/${encoded.hash}`,
    encoded.payload
  );
};
