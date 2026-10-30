import { db } from "@quieter/database/client";
import {
  billingEntitlementOverride,
  billingSubscription,
  mailbox,
  mailboxGrant,
  mailDomain,
  member,
  organization,
  user,
} from "@quieter/database/schema";
import { eq, inArray } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { setMailDomainCatchAll } from "../src/mail-domain/catch-all";
import { createManagedMailbox } from "../src/mailbox/managed-grants";
import { resolveInboundManagedTargetMailboxIds } from "../src/managed-mail/messages/ingestion";

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
    const ownerId = crypto.randomUUID();
    const subscriptionId = crypto.randomUUID();
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
      await db.insert(user).values({
        createdAt: now,
        email: `${ownerId}@example.test`,
        emailVerified: false,
        id: ownerId,
        name: "Catch-all owner",
        updatedAt: now,
      });
      await db.insert(organization).values(
        [organizationId, otherOrganizationId].map((id) => ({
          billingOwnerUserId: ownerId,
          createdAt: now,
          id,
          name: "Catch-all test",
          slug: id,
        }))
      );
      await db.insert(member).values({
        createdAt: now,
        id: crypto.randomUUID(),
        organizationId,
        role: "owner",
        userId: ownerId,
      });
      await db.insert(billingSubscription).values(
        [organizationId, otherOrganizationId].map(
          (id) =>
            ({
              cancelAtPeriodEnd: true,
              createdAt: now,
              currentPeriodEnd: new Date(Date.now() + 86_400_000),
              currentPeriodStart: now,
              id: id === organizationId ? subscriptionId : crypto.randomUUID(),
              metadata: { quieterOrganizationId: id },
              organizationId: id,
              plan: "managed",
              provider: "polar",
              providerProductId: crypto.randomUUID(),
              providerSubscriptionId: crypto.randomUUID(),
              status: "active",
              updatedAt: now,
              userId: ownerId,
            }) satisfies typeof billingSubscription.$inferInsert
        )
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

    beforeEach(async () => {
      await db
        .delete(billingEntitlementOverride)
        .where(eq(billingEntitlementOverride.userId, ownerId));
      await db
        .update(billingSubscription)
        .set({
          currentPeriodEnd: new Date(Date.now() + 86_400_000),
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(billingSubscription.id, subscriptionId));
      await db
        .update(mailDomain)
        .set({ catchAllMailboxId: null })
        .where(eq(mailDomain.id, domainId));
    });

    afterAll(async () => {
      await db
        .delete(organization)
        .where(inArray(organization.id, [organizationId, otherOrganizationId]));
      await db.delete(user).where(eq(user.id, ownerId));
      await db.$client.end();
    });

    test.each(["ended", "revoked", "expired"])(
      "rejects catch-all creation and direct configuration after %s access",
      async (state) => {
        const now = new Date();
        await db
          .update(billingSubscription)
          .set({
            currentPeriodEnd: new Date(Date.now() - 86_400_000),
            status: "canceled",
            updatedAt: now,
          })
          .where(eq(billingSubscription.id, subscriptionId));
        if (state !== "ended") {
          await db.insert(billingEntitlementOverride).values({
            createdAt: now,
            expiresAt: state === "expired" ? new Date(Date.now() - 1000) : null,
            id: crypto.randomUUID(),
            plan: "pro",
            reason: "Catch-all fixture",
            revokedAt: state === "revoked" ? now : null,
            updatedAt: now,
            userId: ownerId,
          });
        }
        for (const accessMode of ["shared", "private"] as const) {
          const emailAddress = `${crypto.randomUUID()}@${domain}`;
          await expect(
            createManagedMailbox({
              accessMode,
              emailAddress: ` ${emailAddress.toUpperCase()} `,
              organizationId,
              ownerUserId: accessMode === "private" ? ownerId : null,
              receiveWholeDomain: true,
              userId: ownerId,
            })
          ).rejects.toMatchObject({ code: "FORBIDDEN" });
          await expect(
            db
              .select({ id: mailbox.id })
              .from(mailbox)
              .where(eq(mailbox.emailAddress, emailAddress))
          ).resolves.toHaveLength(0);
        }
        await expect(
          setMailDomainCatchAll({ domainId, mailboxId: first, organizationId })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        const [stored] = await db
          .select()
          .from(mailDomain)
          .where(eq(mailDomain.id, domainId));
        expect(stored?.catchAllMailboxId).toBeNull();
      }
    );

    test.each([false, undefined])(
      "ordinary creation remains available without billing: %s",
      async (receiveWholeDomain) => {
        await db
          .update(billingSubscription)
          .set({ status: "canceled", updatedAt: new Date() })
          .where(eq(billingSubscription.id, subscriptionId));
        const result = await createManagedMailbox({
          emailAddress: `${crypto.randomUUID()}@${domain}`,
          organizationId,
          receiveWholeDomain,
          userId: ownerId,
        });
        expect(result.mailboxId).toBeTruthy();
        const [stored] = await db
          .select()
          .from(mailDomain)
          .where(eq(mailDomain.id, domainId));
        expect(stored?.catchAllMailboxId).toBeNull();
      }
    );

    test.each(["subscription", "override"])(
      "entitled creation preserves catch-all and owner grants through %s",
      async (access) => {
        const now = new Date();
        if (access === "override") {
          await db
            .update(billingSubscription)
            .set({ status: "canceled", updatedAt: now })
            .where(eq(billingSubscription.id, subscriptionId));
          await db.insert(billingEntitlementOverride).values({
            createdAt: now,
            id: crypto.randomUUID(),
            plan: "pro",
            reason: "Catch-all fixture",
            updatedAt: now,
            userId: ownerId,
          });
        }
        const result = await createManagedMailbox({
          accessMode: access === "override" ? "private" : "shared",
          emailAddress: `${crypto.randomUUID()}@${domain}`,
          organizationId,
          ownerUserId: access === "override" ? ownerId : null,
          receiveWholeDomain: true,
          userId: ownerId,
        });
        const [stored] = await db
          .select()
          .from(mailDomain)
          .where(eq(mailDomain.id, domainId));
        expect(stored?.catchAllMailboxId).toBe(result.mailboxId);
        await expect(
          db
            .select({ role: mailboxGrant.role, userId: mailboxGrant.userId })
            .from(mailboxGrant)
            .where(eq(mailboxGrant.mailboxId, result.mailboxId))
        ).resolves.toMatchObject([{ role: "manager", userId: ownerId }]);
        await db
          .delete(billingEntitlementOverride)
          .where(eq(billingEntitlementOverride.userId, ownerId));
        await db
          .update(billingSubscription)
          .set({ status: "canceled", updatedAt: new Date() })
          .where(eq(billingSubscription.id, subscriptionId));
        await expect(
          resolveInboundManagedTargetMailboxIds([`unmatched@${domain}`])
        ).resolves.toContain(result.mailboxId);
      }
    );

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
