/// <reference types="node" />
import { randomUUID } from "node:crypto";

import { defaultKeyHasher } from "@better-auth/api-key";
import { db } from "@quieter/database/client";
import { apikey } from "@quieter/database/schema";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { organizationApiKeyApi } from "../src/index";
import { ORGANIZATION_API_KEY_CONFIG_ID } from "../src/organization-api-key";

const { databaseUrl } = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
}));
vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    serverEnv: {
      ...original.serverEnv,
      BETTER_AUTH_SECRET: "test-only-organization-api-key-secret-at-least-32",
      DATABASE_URL: databaseUrl,
    },
  };
});

describe.skipIf(databaseUrl === undefined)(
  "organization API key verification on PostgreSQL",
  () => {
    const id = randomUUID();
    const organizationId = randomUUID();
    const key = `quieter_${randomUUID()}`;
    beforeAll(async () => {
      const url = new URL(databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "API key integration tests require disposable loopback PostgreSQL."
        );
      }
      await db.insert(apikey).values({
        configId: ORGANIZATION_API_KEY_CONFIG_ID,
        createdAt: new Date(),
        enabled: true,
        expiresAt: new Date(Date.now() + 600_000),
        id,
        key: await defaultKeyHasher(key),
        rateLimitEnabled: false,
        referenceId: organizationId,
        updatedAt: new Date(),
      });
    });

    afterAll(async () => {
      await db.delete(apikey).where(eq(apikey.id, id));
    });

    test("uses the configured auth context and rejects a key after revocation", async () => {
      const verified = await organizationApiKeyApi.verifyApiKey({
        body: { configId: ORGANIZATION_API_KEY_CONFIG_ID, key },
      });
      expect({
        id: verified.key?.id,
        organizationId: verified.key?.referenceId,
        valid: verified.valid,
      }).toStrictEqual({ id, organizationId, valid: true });
      await db.update(apikey).set({ enabled: false }).where(eq(apikey.id, id));
      const revoked = await organizationApiKeyApi.verifyApiKey({
        body: { configId: ORGANIZATION_API_KEY_CONFIG_ID, key },
      });
      expect({ key: revoked.key, valid: revoked.valid }).toStrictEqual({
        key: null,
        valid: false,
      });
    });
  }
);
