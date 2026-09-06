import { AsyncLocalStorage } from "node:async_hooks";

import { apiKey, defaultKeyHasher } from "@better-auth/api-key";
import { db } from "@quieter/database/client";
import type { DatabaseClient } from "@quieter/database/client";
import { apikey, tables } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { isAPIError } from "better-auth/api";
import { and, eq, or, isNull, sql } from "drizzle-orm";

import {
  ORGANIZATION_API_KEY_CONFIG_ID,
  organizationApiKeyOptions,
} from "./organization-api-key";

const verificationState = new AsyncLocalStorage<{ failed: boolean }>();
const verifier = betterAuth({
  baseURL: serverEnv.BETTER_AUTH_URL ?? "http://localhost:3000",
  database: drizzleAdapter(db, { provider: "pg", schema: tables }),
  logger: {
    log(level, _message, ...args) {
      if (
        level !== "error" ||
        args.some((value) => isAPIError(value) && value.statusCode < 500)
      ) {
        return;
      }
      const state = verificationState.getStore();
      if (state !== undefined) {
        state.failed = true;
      }
    },
  },
  plugins: [apiKey(organizationApiKeyOptions)],
  secret: serverEnv.BETTER_AUTH_SECRET,
});

export type OrganizationApiKeyIdentity = {
  id: string;
  keyHash: string;
  organizationId: string;
};

export class OrganizationApiKeyAuthorizationError extends Error {
  constructor() {
    super("The API key is no longer authorized.");
    this.name = "OrganizationApiKeyAuthorizationError";
  }
}

// oxlint-disable-next-line max-classes-per-file -- Callers distinguish invalid credentials from retryable quota exhaustion.
export class OrganizationApiKeyRateLimitError extends Error {
  constructor() {
    super("API request limit reached. Retry with the same idempotency key.");
    this.name = "OrganizationApiKeyRateLimitError";
  }
}

export const verifyOrganizationApiKey = async (
  request: Request
): Promise<OrganizationApiKeyIdentity | null> => {
  const authorization = request.headers.get("authorization")?.trim();
  if (
    authorization === undefined ||
    authorization.length > 512 ||
    !authorization.startsWith("Bearer ")
  ) {
    return null;
  }
  const key = authorization.slice("Bearer ".length).trim();
  if (key === "") {
    return null;
  }
  const state = { failed: false };
  let verified: Awaited<ReturnType<typeof verifier.api.verifyApiKey>>;
  try {
    verified = await verificationState.run(
      state,
      async () =>
        await verifier.api.verifyApiKey({
          body: { configId: ORGANIZATION_API_KEY_CONFIG_ID, key },
        })
    );
    if (state.failed) {
      throw new Error("Verification dependency failed.");
    }
  } catch {
    const error = new Error("API key verification is temporarily unavailable.");
    reportError(error, { operation: "organization-api-key:verification" });
    throw error;
  }
  if (
    !verified.valid ||
    verified.key === null ||
    verified.key.configId !== ORGANIZATION_API_KEY_CONFIG_ID
  ) {
    if (
      verified.error?.code === "RATE_LIMITED" ||
      verified.error?.code === "USAGE_EXCEEDED"
    ) {
      throw new OrganizationApiKeyRateLimitError();
    }
    return null;
  }
  return {
    id: verified.key.id,
    keyHash: await defaultKeyHasher(key),
    organizationId: verified.key.referenceId,
  };
};

export const assertOrganizationApiKeyAuthorization = async (
  transaction: Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0],
  identity: OrganizationApiKeyIdentity
) => {
  const [current] = await transaction
    .select({ id: apikey.id })
    .from(apikey)
    .where(
      and(
        eq(apikey.id, identity.id),
        eq(apikey.referenceId, identity.organizationId),
        eq(apikey.key, identity.keyHash),
        eq(apikey.configId, ORGANIZATION_API_KEY_CONFIG_ID),
        eq(apikey.enabled, true),
        or(
          isNull(apikey.expiresAt),
          sql`${apikey.expiresAt} > clock_timestamp()`
        )
      )
    )
    .for("share");
  if (current === undefined) {
    throw new OrganizationApiKeyAuthorizationError();
  }
};
