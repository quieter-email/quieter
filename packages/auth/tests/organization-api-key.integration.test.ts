/// <reference types="node" />
import { randomUUID } from "node:crypto";

import { defaultKeyHasher } from "@better-auth/api-key";
import { db } from "@quieter/database/client";
import { apikey } from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  verifyOrganizationApiKey,
  assertOrganizationApiKeyAuthorization,
} from "../src/api-key-verification";
import { organizationApiKeyApi } from "../src/index";
import { ORGANIZATION_API_KEY_CONFIG_ID } from "../src/organization-api-key";

const { databaseUrl } = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
}));
vi.mock(import("@quieter/observability"), async (importOriginal) => ({
  ...(await importOriginal()),
  reportError: vi.fn<typeof reportError>(),
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

    test("verifies without dashboard hooks and fences revocation or replacement before a commit", async () => {
      await db.update(apikey).set({ enabled: true }).where(eq(apikey.id, id));
      const identity = await verifyOrganizationApiKey(
        new Request("https://mail.example.test/api/v2/send", {
          headers: { authorization: `Bearer ${key}` },
        })
      );
      if (identity === null) {
        throw new Error("Expected a verified fixture key.");
      }
      expect({
        id: identity.id,
        organizationId: identity.organizationId,
      }).toStrictEqual({ id, organizationId });
      await db.transaction(async (transaction) => {
        await assertOrganizationApiKeyAuthorization(transaction, identity);
      });
      await expect(
        db.transaction(async (transaction) => {
          await assertOrganizationApiKeyAuthorization(transaction, {
            ...identity,
            organizationId: randomUUID(),
          });
        })
      ).rejects.toThrow("no longer authorized");
      await db.update(apikey).set({ enabled: false }).where(eq(apikey.id, id));
      await expect(
        db.transaction(async (transaction) => {
          await assertOrganizationApiKeyAuthorization(transaction, identity);
        })
      ).rejects.toThrow("no longer authorized");
      await db
        .update(apikey)
        .set({
          enabled: true,
          key: await defaultKeyHasher("replacement-fixture-key"),
        })
        .where(eq(apikey.id, id));
      await expect(
        db.transaction(async (transaction) => {
          await assertOrganizationApiKeyAuthorization(transaction, identity);
        })
      ).rejects.toThrow("no longer authorized");
    });

    test("reports database failure without treating it as an invalid key or exposing query details", async () => {
      const select = db.select.bind(db);
      db.select = () => {
        throw new Error("private database query and credential fixture");
      };
      try {
        await expect(
          verifyOrganizationApiKey(
            new Request("https://mail.example.test/api/v2/send", {
              headers: { authorization: `Bearer ${key}` },
            })
          )
        ).rejects.toThrow("temporarily unavailable");
        expect(reportError).toHaveBeenCalledWith(
          expect.objectContaining({
            message: "API key verification is temporarily unavailable.",
          }),
          { operation: "organization-api-key:verification" }
        );
      } finally {
        db.select = select;
      }
    });
  }
);
