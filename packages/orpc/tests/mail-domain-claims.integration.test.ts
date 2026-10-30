import { readFileSync } from "node:fs";

import { call } from "@orpc/server";
import { db } from "@quieter/database/client";
import { mailDomain, organization, user } from "@quieter/database/schema";
import { eq, inArray, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { assertMailDomainOwnerAvailable } from "../src/mail-domain/ownership";
import { getMailDomainOwnershipToken } from "../src/mail-domain/records";
import { getEmailIdentity } from "../src/mail-domain/service";
import { verifyMailDomainSetup } from "../src/mail-domain/verification";
import { mailDomainsRouter } from "../src/routers/mail-domains";

const mocks = vi.hoisted(() => ({
  cleanup: vi
    .fn<(domain: string) => Promise<boolean>>()
    .mockResolvedValue(true),
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  disableReceipt: vi
    .fn<(domain: string) => Promise<boolean>>()
    .mockResolvedValue(true),
  dnsTokens: new Set<string>(),
  identity: {
    $metadata: {},
    DkimAttributes: { Tokens: ["one", "two", "three"] },
  },
  receipt: vi.fn<(domain: string) => Promise<void>>().mockResolvedValue(),
  userId: crypto.randomUUID(),
}));
vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: { ...actual.serverEnv, DATABASE_URL: mocks.databaseUrl },
  };
});
/* oxlint-disable require-await -- Resolver and session fixtures must preserve their asynchronous provider contracts. */
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Only the protected procedure session contract is needed.
vi.mock("@quieter/auth/session", () => ({
  getSessionWithOrganization: async () => ({
    session: { id: "session" },
    user: { email: "claims@example.test", id: mocks.userId, name: "Claims" },
  }),
}));
vi.mock(import("@quieter/billing/entitlements"), () => ({
  getOrganizationBillingEntitlement: async () => ({
    account: null,
    hasAccess: true,
    hasUnlimitedAccess: true,
    product: null,
  }),
}));
vi.mock(import("../src/mail-domain/service"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    assertUserCanManageMailDomains: vi
      .fn<typeof actual.assertUserCanManageMailDomains>()
      .mockResolvedValue(),
    createOrLoadEmailIdentity: vi
      .fn<typeof actual.createOrLoadEmailIdentity>()
      .mockResolvedValue(mocks.identity),
    defaultDnsLookup: {
      resolveCname: async (name: string) => [
        `${name.split(".")[0]}.dkim.amazonses.com`,
      ],
      resolveMx: async (name: string) => [
        {
          exchange: name.startsWith("bounce.")
            ? "feedback-smtp.eu-central-1.amazonses.com"
            : "inbound-smtp.eu-central-1.amazonaws.com",
          priority: 10,
        },
      ],
      resolveTxt: async (name: string) =>
        name.startsWith("_quieter-verify.")
          ? [...mocks.dnsTokens].map((token) => [
              `quieter-domain-verification=${token}`,
            ])
          : [["v=spf1 include:amazonses.com -all"]],
    },
    deleteMailDomainAwsResources: mocks.cleanup,
    deleteMailDomainReceiptRule: mocks.disableReceipt,
    ensureMailFromDomain: vi
      .fn<typeof actual.ensureMailFromDomain>()
      .mockResolvedValue(),
    ensureReceiptRule: mocks.receipt,
    getAwsRegion: () => "eu-central-1",
    getEmailIdentity: vi
      .fn<typeof actual.getEmailIdentity>()
      .mockResolvedValue(mocks.identity),
  };
});

/* oxlint-enable require-await */

const context = { db, headers: new Headers() };

describe.skipIf(mocks.databaseUrl === undefined)(
  "organization-bound domain claims on PostgreSQL",
  () => {
    const organizations = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    const [hostile = "", rightful = "", other = ""] = organizations;
    beforeAll(async () => {
      const url = new URL(mocks.databaseUrl ?? "");
      if (
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Domain claims require disposable loopback quieter_migration_test."
        );
      }
      const now = new Date();
      await db.insert(user).values({
        createdAt: now,
        email: `${mocks.userId}@example.test`,
        emailVerified: true,
        id: mocks.userId,
        name: "Claims",
        updatedAt: now,
      });
      await db.insert(organization).values(
        organizations.map((id) => ({
          createdAt: now,
          id,
          name: "Claims",
          slug: id,
        }))
      );
    });
    beforeEach(() => {
      vi.clearAllMocks();
      mocks.dnsTokens.clear();
    });

    afterAll(async () => {
      await db
        .delete(organization)
        .where(inArray(organization.id, organizations));
      await db.delete(user).where(eq(user.id, mocks.userId));
      await db.$client.end();
    });

    test("expansion retains exclusivity while same-team setup remains available", async () => {
      const domain = `${crypto.randomUUID()}.example.com`;
      const claim = await call(
        mailDomainsRouter.createSetup,
        { domain, mode: "send_only", organizationId: hostile },
        { context }
      );
      await expect(
        call(
          mailDomainsRouter.createSetup,
          { domain, mode: "send_only", organizationId: rightful },
          { context }
        )
      ).rejects.toMatchObject({
        cause: { code: "23505", constraint_name: "mail_domain_domain_unique" },
      });
      await expect(
        call(
          mailDomainsRouter.createSetup,
          { domain, mode: "send_only", organizationId: hostile },
          { context }
        )
      ).resolves.toMatchObject({ domainId: claim.domainId });
    });

    describe("after the separately reviewed contraction", () => {
      beforeAll(async () => {
        await db.execute(
          sql`ALTER TABLE "mailDomain" DROP CONSTRAINT IF EXISTS "mail_domain_domain_unique"`
        );
      });

      afterAll(async () => {
        await db
          .delete(mailDomain)
          .where(inArray(mailDomain.organizationId, organizations));
        await db.execute(
          sql`ALTER TABLE "mailDomain" ADD CONSTRAINT "mail_domain_domain_unique" UNIQUE ("domain")`
        );
      });

      test("a pending squatter cannot block the DNS owner or reuse its proof", async () => {
        const domain = `${crypto.randomUUID()}.example.com`;
        const attacker = await call(
          mailDomainsRouter.createSetup,
          { domain, mode: "send_and_receive", organizationId: hostile },
          { context }
        );
        const owner = await call(
          mailDomainsRouter.createSetup,
          {
            domain: `https://${domain.toUpperCase()}.`,
            mode: "send_and_receive",
            organizationId: rightful,
          },
          { context }
        );
        const token = getMailDomainOwnershipToken(owner.records);
        expect(token).not.toBe(getMailDomainOwnershipToken(attacker.records));
        if (token === null) {
          throw new Error("Missing ownership challenge");
        }
        mocks.dnsTokens.add(token);
        await expect(
          verifyMailDomainSetup({
            domainId: attacker.domainId,
            organizationId: hostile,
          })
        ).resolves.toMatchObject({ status: "failed" });
        await expect(
          verifyMailDomainSetup({
            domainId: owner.domainId,
            organizationId: rightful,
          })
        ).resolves.toMatchObject({ status: "verified" });
        await expect(
          verifyMailDomainSetup({
            domainId: attacker.domainId,
            organizationId: hostile,
          })
        ).rejects.toMatchObject({ code: "CONFLICT" });
        await call(
          mailDomainsRouter.remove,
          { domainId: attacker.domainId, organizationId: hostile },
          { context }
        );
        expect(mocks.cleanup).not.toHaveBeenCalled();
        expect(mocks.disableReceipt).not.toHaveBeenCalled();
        await expect(
          verifyMailDomainSetup({
            domainId: owner.domainId,
            organizationId: rightful,
          })
        ).resolves.toMatchObject({ status: "verified" });
      });

      test("concurrent valid proofs have one owner and failed rechecks never release it", async () => {
        const domain = `${crypto.randomUUID()}.example.com`;
        const claims = await Promise.all(
          [hostile, rightful].map(
            async (organizationId) =>
              await call(
                mailDomainsRouter.createSetup,
                { domain, mode: "send_and_receive", organizationId },
                { context }
              )
          )
        );
        for (const claim of claims) {
          const token = getMailDomainOwnershipToken(claim.records);
          if (token === null) {
            throw new Error("Missing ownership challenge");
          }
          mocks.dnsTokens.add(token);
        }
        const results = await Promise.allSettled(
          claims.map(
            async (claim, index) =>
              await verifyMailDomainSetup({
                domainId: claim.domainId,
                organizationId: organizations[index] ?? "",
              })
          )
        );
        expect(
          results.filter((result) => result.status === "fulfilled")
        ).toHaveLength(1);
        expect(
          results.filter((result) => result.status === "rejected")
        ).toHaveLength(1);
        expect(mocks.receipt).toHaveBeenCalledOnce();
        const winnerIndex = results.findIndex(
          (result) => result.status === "fulfilled"
        );
        const winner = claims[winnerIndex];
        if (winner === undefined) {
          throw new Error("Missing winner");
        }
        const organizationId = organizations[winnerIndex] ?? "";
        mocks.dnsTokens.clear();
        await expect(
          verifyMailDomainSetup({ domainId: winner.domainId, organizationId })
        ).resolves.toMatchObject({ status: "failed" });
        await expect(
          call(
            mailDomainsRouter.createSetup,
            { domain, mode: "send_only", organizationId: other },
            { context }
          )
        ).rejects.toMatchObject({ code: "CONFLICT" });
        await call(
          mailDomainsRouter.updateMode,
          { domainId: winner.domainId, mode: "send_only", organizationId },
          { context }
        );
        await expect(
          verifyMailDomainSetup({
            domainId: claims[1 - winnerIndex]?.domainId ?? "",
            organizationId: organizations[1 - winnerIndex] ?? "",
          })
        ).rejects.toMatchObject({ code: "CONFLICT" });
        await call(
          mailDomainsRouter.remove,
          { domainId: winner.domainId, organizationId },
          { context }
        );
        await expect(
          call(
            mailDomainsRouter.createSetup,
            { domain, mode: "send_only", organizationId: other },
            { context }
          )
        ).resolves.toMatchObject({ domain });
      });

      test("pending removal waits for verification and cannot delete the new owner's resources", async () => {
        const domain = `${crypto.randomUUID()}.example.com`;
        const attacker = await call(
          mailDomainsRouter.createSetup,
          { domain, mode: "send_and_receive", organizationId: hostile },
          { context }
        );
        const owner = await call(
          mailDomainsRouter.createSetup,
          { domain, mode: "send_and_receive", organizationId: rightful },
          { context }
        );
        const token = getMailDomainOwnershipToken(owner.records);
        if (token === null) {
          throw new Error("Missing ownership challenge");
        }
        mocks.dnsTokens.add(token);
        const entered = Promise.withResolvers<boolean>();
        const release = Promise.withResolvers<boolean>();
        vi.mocked(getEmailIdentity).mockImplementationOnce(async () => {
          entered.resolve(true);
          await release.promise;
          return mocks.identity;
        });
        const verification = verifyMailDomainSetup({
          domainId: owner.domainId,
          organizationId: rightful,
        });
        await entered.promise;
        const removal = call(
          mailDomainsRouter.remove,
          { domainId: attacker.domainId, organizationId: hostile },
          { context }
        );
        release.resolve(true);
        await expect(verification).resolves.toMatchObject({
          status: "verified",
        });
        await expect(removal).resolves.toMatchObject({ removed: true });
        expect(mocks.cleanup).not.toHaveBeenCalled();
        expect(mocks.disableReceipt).not.toHaveBeenCalled();
      });

      test("the expand migration protects legacy owners against old-release state resets", async () => {
        await db.transaction(async (database) => {
          await database.execute(sql`SET LOCAL search_path TO pg_temp, public`);
          await database.execute(
            sql`CREATE TEMP TABLE "mailDomain" ("id" text, "domain" text, "organizationId" text, "status" text, "verifiedAt" timestamp, "updatedAt" timestamp) ON COMMIT DROP`
          );
          await database.execute(
            sql`CREATE TEMP TABLE "mailbox" ("organizationId" text, "provider" text, "emailAddress" text) ON COMMIT DROP`
          );
          await database.execute(
            sql`INSERT INTO "mailDomain" VALUES ('legacy', 'legacy.example.com', ${rightful}, 'verified', now(), now()), ('pending', 'pending.example.com', ${hostile}, 'pending_dns', null, now()), ('managed', 'managed.example.com', ${rightful}, 'failed', null, now())`
          );
          await database.execute(
            sql`INSERT INTO "mailbox" VALUES (${rightful}, 'managed', 'inbox@managed.example.com')`
          );
          const migration = readFileSync(
            new URL(
              "../../database/drizzle/20261029234109_puzzling_the_call/migration.sql",
              import.meta.url
            ),
            "utf8"
          );
          for (const statement of migration.split("--> statement-breakpoint")) {
            // oxlint-disable-next-line no-await-in-loop -- Migration statements must retain their transaction order.
            await database.execute(
              sql.raw(
                statement.replaceAll(
                  '"preserveMailDomainOwnership"',
                  'pg_temp."preserveMailDomainOwnership"'
                )
              )
            );
          }
          await database.execute(
            sql`UPDATE "mailDomain" SET "status" = 'verified', "verifiedAt" = now() WHERE "id" = 'pending'`
          );
          await database.execute(
            sql`UPDATE "mailDomain" SET "status" = 'failed', "verifiedAt" = null WHERE "id" IN ('legacy', 'pending')`
          );
          await expect(
            assertMailDomainOwnerAvailable({
              database,
              domain: "legacy.example.com",
              organizationId: hostile,
            })
          ).rejects.toMatchObject({ code: "CONFLICT" });
          await expect(
            assertMailDomainOwnerAvailable({
              database,
              domain: "managed.example.com",
              organizationId: hostile,
            })
          ).rejects.toMatchObject({ code: "CONFLICT" });
          await expect(
            assertMailDomainOwnerAvailable({
              database,
              domain: "pending.example.com",
              organizationId: rightful,
            })
          ).rejects.toMatchObject({ code: "CONFLICT" });
        });
      });

      test("legacy verified domains stay owned through mode changes and failed DNS checks", async () => {
        const domain = `${crypto.randomUUID()}.example.com`;
        const owner = await call(
          mailDomainsRouter.createSetup,
          { domain, mode: "send_and_receive", organizationId: rightful },
          { context }
        );
        await db
          .update(mailDomain)
          .set({ ownershipVerifiedAt: null, status: "verified" })
          .where(eq(mailDomain.id, owner.domainId));
        await call(
          mailDomainsRouter.updateMode,
          {
            domainId: owner.domainId,
            mode: "send_only",
            organizationId: rightful,
          },
          { context }
        );
        await expect(
          call(
            mailDomainsRouter.createSetup,
            { domain, mode: "send_only", organizationId: hostile },
            { context }
          )
        ).rejects.toMatchObject({ code: "CONFLICT" });
        await expect(
          verifyMailDomainSetup({
            domainId: owner.domainId,
            organizationId: rightful,
          })
        ).resolves.toMatchObject({ status: "failed" });
        await expect(
          call(
            mailDomainsRouter.createSetup,
            { domain, mode: "send_only", organizationId: hostile },
            { context }
          )
        ).rejects.toMatchObject({ code: "CONFLICT" });
      });

      test("same-team retries keep the challenge and independent removal never deletes shared identity", async () => {
        const domain = `${crypto.randomUUID()}.example.com`;
        const claims = await Promise.all(
          [hostile, rightful].map(
            async (organizationId) =>
              await call(
                mailDomainsRouter.createSetup,
                { domain, mode: "send_only", organizationId },
                { context }
              )
          )
        );
        const retry = await call(
          mailDomainsRouter.createSetup,
          { domain, mode: "send_only", organizationId: hostile },
          { context }
        );
        expect(retry.domainId).toBe(claims[0]?.domainId);
        expect(getMailDomainOwnershipToken(retry.records)).toBe(
          getMailDomainOwnershipToken(claims[0]?.records ?? [])
        );
        await call(
          mailDomainsRouter.remove,
          { domainId: retry.domainId, organizationId: hostile },
          { context }
        );
        expect(mocks.cleanup).not.toHaveBeenCalled();
        await call(
          mailDomainsRouter.remove,
          { domainId: claims[1]?.domainId ?? "", organizationId: rightful },
          { context }
        );
        expect(mocks.cleanup).toHaveBeenCalledOnce();
        const renewed = await call(
          mailDomainsRouter.createSetup,
          { domain, mode: "send_only", organizationId: hostile },
          { context }
        );
        expect(renewed.domainId).not.toBe(retry.domainId);
        expect(getMailDomainOwnershipToken(renewed.records)).not.toBe(
          getMailDomainOwnershipToken(retry.records)
        );
        await expect(
          verifyMailDomainSetup({
            domainId: retry.domainId,
            organizationId: hostile,
          })
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
    });
  }
);
