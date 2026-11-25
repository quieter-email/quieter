import { AsyncLocalStorage } from "node:async_hooks";

import { serverEnv } from "@quieter/env/server";
import {
  MAIL_DISPATCH_BATCH_SIZE,
  MAIL_DISPATCH_NOTICE,
  mailDispatchRequestSchema,
} from "@quieter/mail/dispatch";
import { signMailPayload } from "@quieter/mail/updates";
import { reportError } from "@quieter/observability";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Notice } from "postgres";
// Workers resolve this entry to the Cloudflare loader, which can see linked
// Hyperdrive bindings inside Durable Objects. The package root cannot.
import { Resource } from "sst/resource";

import { assertLocalDevelopmentDatabaseUrl } from "../scripts/local-development.ts";
import { authRelations } from "./schema.ts";

declare const __QUIETER_LOCAL_DEVELOPMENT__: boolean;

export type DatabaseClient = ReturnType<typeof drizzlePostgres>;
export type DatabaseTransaction = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];
export type DatabaseExecutor = DatabaseClient | DatabaseTransaction;

const getLinkedHyperdriveConnectionString = (): string | undefined => {
  try {
    const appDatabase: unknown = Reflect.get(Resource, "AppDatabaseV2");
    if (typeof appDatabase !== "object" || appDatabase === null) {
      return undefined;
    }

    const connectionString: unknown = Reflect.get(
      appDatabase,
      "connectionString"
    );
    if (typeof connectionString !== "string" || connectionString === "") {
      return undefined;
    }
    return connectionString;
  } catch {
    return undefined;
  }
};

const getDatabaseUrl = () => {
  const linkedConnectionString = getLinkedHyperdriveConnectionString();

  const databaseUrl = linkedConnectionString ?? serverEnv.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is missing");
  }
  if (
    // oxlint-disable-next-line unicorn/no-typeof-undefined -- Node callers do not receive Vite's compile-time marker.
    (typeof __QUIETER_LOCAL_DEVELOPMENT__ !== "undefined" &&
      __QUIETER_LOCAL_DEVELOPMENT__) ||
    serverEnv.QUIETER_DEPLOYMENT_ENV === "local"
  ) {
    assertLocalDevelopmentDatabaseUrl("DATABASE_URL", databaseUrl, {
      QUIETER_DEPLOYMENT_ENV: "local",
      QUIETER_LOCAL_PLANETSCALE_HOST: serverEnv.QUIETER_LOCAL_PLANETSCALE_HOST,
    });
  }
  return databaseUrl;
};

export const assertDatabaseConfigured = () => {
  getDatabaseUrl();
};

const isWorker =
  typeof navigator !== "undefined" &&
  navigator.userAgent === "Cloudflare-Workers";
const createDatabaseClient = (
  databaseUrl = getDatabaseUrl(),
  onnotice?: (notice: Notice) => void
) => {
  const hyperdrive = databaseUrl === getLinkedHyperdriveConnectionString();
  const sql = postgres(databaseUrl, {
    connect_timeout: 10,
    fetch_types: false,
    idle_timeout: 20,
    max:
      serverEnv.QUIETER_DEPLOYMENT_ENV === "local" ||
      (!isWorker && onnotice !== undefined)
        ? 1
        : 5,
    onnotice,
    prepare: hyperdrive,
  });
  return drizzlePostgres({
    client: sql,
    relations: authRelations,
  });
};

const requestDatabaseClient = new AsyncLocalStorage<DatabaseClient>();
let directDatabaseClient: DatabaseClient | undefined;

const getDatabaseClient = () => {
  const scopedClient = requestDatabaseClient.getStore();

  if (scopedClient) {
    return scopedClient;
  }

  if (isWorker || getLinkedHyperdriveConnectionString()) {
    throw new Error(
      "Worker database access requires withRequestDatabaseClient."
    );
  }

  directDatabaseClient ??= createDatabaseClient();
  return directDatabaseClient;
};

const deliverMailDispatchWake = async (
  url: string,
  secret: string,
  eventIds: string[]
) => {
  try {
    const body = JSON.stringify(
      mailDispatchRequestSchema.parse({
        eventIds,
        expiresAt: Date.now() + 30_000,
        purpose: "mail-dispatch-event",
      })
    );
    const response = await fetch(url, {
      body,
      headers: {
        "content-type": "application/json",
        "x-mail-signature": await signMailPayload(body, secret),
      },
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      throw new Error("Mail dispatch wake was not accepted.");
    }
    return true;
  } catch (error) {
    reportError(error, { boundary: "mail-dispatch-wake" });
    return false;
  }
};

export const withRequestDatabaseClient = async <Result>(
  run: (client: DatabaseClient) => Result | Promise<Result>,
  options: {
    defer?: (task: Promise<boolean>) => void;
    independent?: boolean;
  } = {}
): Promise<Result> => {
  const requestClient = requestDatabaseClient.getStore();
  if (requestClient && options.independent !== true) {
    return await run(requestClient);
  }

  const dispatchUrl = serverEnv.MAIL_DISPATCH_URL;
  const signingKey = serverEnv.GMAIL_LIVE_SYNC_TOKEN_SECRET;
  if (dispatchUrl && signingKey) {
    const eventIds = new Set<string>();
    const client = createDatabaseClient(undefined, (notice) => {
      if (
        notice.message === MAIL_DISPATCH_NOTICE &&
        typeof notice.detail === "string" &&
        eventIds.size < MAIL_DISPATCH_BATCH_SIZE * 4
      ) {
        eventIds.add(notice.detail);
      }
    });
    try {
      return await requestDatabaseClient.run(
        client,
        async () => await run(client)
      );
    } finally {
      if (!isWorker) {
        await client.$client.end({ timeout: 1 });
      }
      if (eventIds.size > 0) {
        const ids = [...eventIds];
        const wake = (async () => {
          const results = await Promise.all(
            Array.from(
              { length: Math.ceil(ids.length / MAIL_DISPATCH_BATCH_SIZE) },
              async (_, index) =>
                await deliverMailDispatchWake(
                  dispatchUrl,
                  signingKey,
                  ids.slice(
                    index * MAIL_DISPATCH_BATCH_SIZE,
                    (index + 1) * MAIL_DISPATCH_BATCH_SIZE
                  )
                )
            )
          );
          return results.every(Boolean);
        })();
        if (options.defer === undefined) {
          await wake;
        } else {
          options.defer(wake);
        }
      }
    }
  }
  // Workers own request-local sockets; Node reuses one bounded process pool.
  const client =
    isWorker || getLinkedHyperdriveConnectionString()
      ? createDatabaseClient()
      : getDatabaseClient();
  return await requestDatabaseClient.run(client, async () => await run(client));
};

const databaseProxyHandler: ProxyHandler<DatabaseClient> = {
  get(_target, property): unknown {
    const client = getDatabaseClient();
    const value: unknown = Reflect.get(client, property);
    if (typeof value === "function" && property !== "$client") {
      return (...args: unknown[]) =>
        Reflect.apply(value, client, args) as unknown;
    }
    return value;
  },
};

// The handler ignores the target; this inert object prevents import-time client creation.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
export const db = new Proxy({} as DatabaseClient, databaseProxyHandler);
