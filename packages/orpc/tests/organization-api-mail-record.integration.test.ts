/// <reference types="node" />
import { randomUUID } from "node:crypto";

import { assertLocalDatabaseUrl } from "@quieter/database/local-development";
import {
  organization,
  organizationApiMailAttachment,
  organizationApiMailMessage,
} from "@quieter/database/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it } from "vite-plus/test";

import { recordOrganizationApiMailMessage } from "../src/organization-api-mail-record.ts";

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;

describe.skipIf(databaseUrl === undefined)(
  "atomic API message projections",
  () => {
    it("rolls back a failed attachment write, then retries without partial history or duplicates", async () => {
      if (databaseUrl === undefined) {
        throw new Error("Missing disposable database.");
      }
      assertLocalDatabaseUrl(databaseUrl, "quieter_migration_test");
      const connection = postgres(databaseUrl, { max: 2, prepare: false });
      const database = drizzle({ client: connection });
      const organizationId = randomUUID();
      const input = {
        attachments: [
          {
            fileName: "fixture.txt",
            inline: false,
            mimeType: "text/plain",
            size: 7,
          },
        ],
        bodyText: "Fixture",
        organizationId,
        providerMessageId: randomUUID(),
        sender: "sender@example.com",
        subject: "Atomic fixture",
        to: ["reader@example.com"],
      };
      try {
        await database.insert(organization).values({
          createdAt: new Date(),
          id: organizationId,
          name: "Projection fixture",
          slug: organizationId,
        });
        await expect(
          recordOrganizationApiMailMessage(
            {
              ...input,
              attachments: [
                { ...input.attachments[0], size: Number.MAX_SAFE_INTEGER },
              ],
            },
            database
          )
        ).rejects.toMatchObject({ cause: { code: "22003" } });
        await expect(
          database
            .select()
            .from(organizationApiMailMessage)
            .where(
              eq(organizationApiMailMessage.organizationId, organizationId)
            )
        ).resolves.toHaveLength(0);
        await Promise.all([
          recordOrganizationApiMailMessage(input, database),
          recordOrganizationApiMailMessage(input, database),
        ]);
        await expect(
          database
            .select()
            .from(organizationApiMailMessage)
            .where(
              eq(organizationApiMailMessage.organizationId, organizationId)
            )
        ).resolves.toHaveLength(1);
        await expect(
          database
            .select()
            .from(organizationApiMailAttachment)
            .where(
              eq(organizationApiMailAttachment.organizationId, organizationId)
            )
        ).resolves.toHaveLength(1);
      } finally {
        await database
          .delete(organization)
          .where(eq(organization.id, organizationId));
        await connection.end({ timeout: 1 });
      }
    });
  }
);
