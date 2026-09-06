import { createHash } from "node:crypto";

import {
  assertOrganizationApiKeyAuthorization,
  verifyOrganizationApiKey,
} from "@quieter/auth/api-key-verification";
import { ORGANIZATION_API_KEY_CONFIG_ID } from "@quieter/auth/organization-api-key";
import { db, withRequestDatabaseClient } from "@quieter/database/client";
import { apikey } from "@quieter/database/schema";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const original = await importOriginal();
  const { env: bindings } = await import("cloudflare:workers");
  return {
    ...original,
    serverEnv: {
      ...original.serverEnv,
      BETTER_AUTH_SECRET: "native-test-only-api-key-secret-at-least-32",
      DATABASE_URL: bindings.AppDatabaseV2.connectionString,
    },
  };
});

const url: unknown = Reflect.get(env, "MIGRATION_TEST_DATABASE_URL");
describe.skipIf(typeof url !== "string" || url === "")(
  "native mail API key verification",
  () => {
    it("verifies and rechecks a key using one request's database context without frontend bindings", async () => {
      await withRequestDatabaseClient(async (database) => {
        const id = crypto.randomUUID();
        const organizationId = crypto.randomUUID();
        const key = `quieter_${crypto.randomUUID()}`;
        try {
          await database.insert(apikey).values({
            configId: ORGANIZATION_API_KEY_CONFIG_ID,
            createdAt: new Date(),
            enabled: true,
            expiresAt: new Date(Date.now() + 60_000),
            id,
            key: createHash("sha256").update(key).digest("base64url"),
            rateLimitEnabled: false,
            referenceId: organizationId,
            updatedAt: new Date(),
          });
          const request = new Request("https://mail.example.test/api/v2/send", {
            headers: { authorization: `Bearer ${key}` },
          });
          const identity = await verifyOrganizationApiKey(request);
          if (identity === null) {
            throw new Error("Native verification rejected the fixture key.");
          }
          expect({
            id: identity.id,
            organizationId: identity.organizationId,
          }).toStrictEqual({ id, organizationId });
          await db.transaction(async (transaction) => {
            await assertOrganizationApiKeyAuthorization(transaction, identity);
          });
          await database
            .update(apikey)
            .set({ enabled: false })
            .where(eq(apikey.id, id));
          await expect(verifyOrganizationApiKey(request)).resolves.toBeNull();
          await expect(
            db.transaction(async (transaction) => {
              await assertOrganizationApiKeyAuthorization(
                transaction,
                identity
              );
            })
          ).rejects.toThrow("no longer authorized");
        } finally {
          await database.delete(apikey).where(eq(apikey.id, id));
        }
      });
    }, 15_000);
  }
);
