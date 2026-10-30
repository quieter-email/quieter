import { db } from "@quieter/database/client";
import { mailDomain, organization } from "@quieter/database/schema";
import { sendMessageInputSchema } from "@quieter/mail/send";
import { buildSendMimeMessage } from "@quieter/mail/send-mime";
import { inArray } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { assertOrganizationOwnsVerifiedSenderDomain } from "../src/organization-mail-policy";

const { databaseUrl } = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
}));
vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: { ...actual.serverEnv, DATABASE_URL: databaseUrl },
  };
});

describe.skipIf(databaseUrl === undefined)(
  "sender domain isolation on PostgreSQL",
  () => {
    const organizationId = crypto.randomUUID();
    const otherOrganizationId = crypto.randomUUID();
    const ownDomain = `${crypto.randomUUID()}.example.com`;
    const otherDomain = `${crypto.randomUUID()}.example.com`;
    const pendingDomain = `${crypto.randomUUID()}.example.com`;

    beforeAll(async () => {
      const url = new URL(databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Sender policy tests require loopback quieter_migration_test."
        );
      }
      const now = new Date();
      await db.insert(organization).values(
        [organizationId, otherOrganizationId].map((id) => ({
          createdAt: now,
          id,
          name: "Sender policy fixture",
          slug: id,
        }))
      );
      await db.insert(mailDomain).values(
        [
          { domain: ownDomain, organizationId, status: "verified" as const },
          {
            domain: otherDomain,
            organizationId: otherOrganizationId,
            status: "verified" as const,
          },
          {
            domain: pendingDomain,
            organizationId,
            status: "pending_dns" as const,
          },
        ].map((domain) => ({
          ...domain,
          createdAt: now,
          id: crypto.randomUUID(),
          mailFromDomain: `bounce.${domain.domain}`,
          requiredDnsRecords: [],
          updatedAt: now,
        }))
      );
    });

    afterAll(async () => {
      await db
        .delete(organization)
        .where(inArray(organization.id, [organizationId, otherOrganizationId]));
    });

    test("blocks parser differentials even with an owned verified angle address", async () => {
      await expect(
        assertOrganizationOwnsVerifiedSenderDomain({
          organizationId,
          sender: `victim@${otherDomain} ( <sender@${ownDomain}>`,
        })
      ).rejects.toMatchObject({ status: 400 });
    });

    test("rejects other tenants and unverified sender domains", async () => {
      for (const domain of [otherDomain, pendingDomain]) {
        await expect(
          assertOrganizationOwnsVerifiedSenderDomain({
            organizationId,
            sender: `sender@${domain}`,
          })
        ).rejects.toMatchObject({ status: 403 });
      }
    });

    test("authorizes the identity serialized for a legitimate quoted display name", async () => {
      const message = sendMessageInputSchema.parse({
        from: `"Doe, Jane (sales)" <Sender@${ownDomain}>`,
        subject: "Hello",
        text: "Hello",
        to: "to@example.com",
      });
      const built = await buildSendMimeMessage(message);
      await expect(
        assertOrganizationOwnsVerifiedSenderDomain({
          organizationId,
          sender: built.fromAddress,
        })
      ).resolves.toBe(ownDomain);
    });
  }
);
