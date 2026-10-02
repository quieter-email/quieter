import { db } from "@quieter/database/client";
import { mailbox, mailDomain, organization } from "@quieter/database/schema";
import { eq, inArray } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { setMailDomainCatchAll } from "../src/mail-domain/catch-all";

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
  "catch-all ownership on PostgreSQL",
  () => {
    const organizationId = crypto.randomUUID();
    const otherOrganizationId = crypto.randomUUID();
    const domainId = crypto.randomUUID();
    const domain = `${domainId}.example.test`;
    const mailboxIds = Array.from({ length: 4 }, () => crypto.randomUUID());
    const [first = "", second = "", foreign = "", wrongDomain = ""] =
      mailboxIds;
    beforeAll(async () => {
      const url = new URL(databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Catch-all integration tests require loopback quieter_migration_test."
        );
      }
      const now = new Date();
      await db.insert(organization).values(
        [organizationId, otherOrganizationId].map((id) => ({
          createdAt: now,
          id,
          name: "Catch-all test",
          slug: id,
        }))
      );
      await db.insert(mailbox).values(
        mailboxIds.map((id) => ({
          createdAt: now,
          emailAddress: `${id}@${id === wrongDomain ? "other.example.test" : domain}`,
          id,
          organizationId: id === foreign ? otherOrganizationId : organizationId,
          provider: "managed" as const,
          updatedAt: now,
        }))
      );
      await db.insert(mailDomain).values({
        createdAt: now,
        domain,
        id: domainId,
        mailFromDomain: `mail.${domain}`,
        organizationId,
        requiredDnsRecords: [],
        status: "verified",
        updatedAt: now,
      });
    });

    afterAll(async () => {
      await db
        .delete(organization)
        .where(inArray(organization.id, [organizationId, otherOrganizationId]));
      await db.$client.end();
    });

    test("another organization cannot claim or clear an existing domain", async () => {
      await setMailDomainCatchAll({
        domainId,
        mailboxId: first,
        organizationId,
      });
      await expect(
        setMailDomainCatchAll({
          domainId,
          mailboxId: second,
          organizationId: otherOrganizationId,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        setMailDomainCatchAll({
          domainId,
          mailboxId: null,
          organizationId: otherOrganizationId,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      const [stored] = await db
        .select()
        .from(mailDomain)
        .where(eq(mailDomain.id, domainId));
      expect(stored?.catchAllMailboxId).toBe(first);
      await setMailDomainCatchAll({
        domainId,
        mailboxId: null,
        organizationId,
      });
    });

    test("two competing inboxes cannot both acquire a domain", async () => {
      const results = await Promise.allSettled(
        [first, second].map(
          async (mailboxId) =>
            await setMailDomainCatchAll({ domainId, mailboxId, organizationId })
        )
      );
      expect(
        results.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      expect(
        results.find((result) => result.status === "rejected")
      ).toMatchObject({ reason: { code: "CONFLICT" } });
      const [stored] = await db
        .select()
        .from(mailDomain)
        .where(eq(mailDomain.id, domainId));
      expect(stored?.catchAllMailboxId).toBe(
        results.find((result) => result.status === "fulfilled")?.value.catchAll
          ?.mailboxId
      );
      await setMailDomainCatchAll({
        domainId,
        mailboxId: null,
        organizationId,
      });
    });

    test.each([foreign, wrongDomain])(
      "rejects a mailbox outside the domain's ownership: %s",
      async (mailboxId) => {
        await expect(
          setMailDomainCatchAll({ domainId, mailboxId, organizationId })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }
    );

    test.each([
      { mode: "send_only" as const, status: "verified" as const },
      { mode: "send_and_receive" as const, status: "pending_dns" as const },
    ])("rejects an ineligible domain: %o", async (settings) => {
      await db
        .update(mailDomain)
        .set(settings)
        .where(eq(mailDomain.id, domainId));
      await expect(
        setMailDomainCatchAll({ domainId, mailboxId: first, organizationId })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await db
        .update(mailDomain)
        .set({ mode: "send_and_receive", status: "verified" })
        .where(eq(mailDomain.id, domainId));
    });
  }
);
