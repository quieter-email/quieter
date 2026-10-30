import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { db } from "@quieter/database/client";
import {
  invitation,
  mailbox,
  member,
  organization,
  user,
} from "@quieter/database/schema";
import { eq, inArray, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import type { auth as configuredAuth } from "../src/index";
import {
  assertCanLeaveOrganization,
  createDefaultOrganizationName,
  ensureUserOrganizationState,
} from "../src/organization";

const { databaseUrl, sendMagicLinkEmail } = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  sendMagicLinkEmail: vi
    .fn<(input: { email: string; url: string }) => Promise<void>>()
    .mockResolvedValue(),
}));
vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    serverEnv: {
      ...original.serverEnv,
      BETTER_AUTH_SECRET:
        "organization-proof-secret-value-at-least-32-characters",
      BETTER_AUTH_URL: "http://localhost:3000",
      DATABASE_URL: databaseUrl,
    },
  };
});

vi.mock(import("../src/email"), () => ({
  sendMagicLinkEmail,
  sendVerificationEmail: vi.fn<() => Promise<void>>(),
}));

describe.skipIf(databaseUrl === undefined)(
  "one-time organization provisioning",
  () => {
    let auth: typeof configuredAuth;
    const userIds: string[] = [];
    const organizationIds: string[] = [];
    beforeAll(async () => {
      ({ auth } = await import("../src/index"));
      const url = new URL(databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Provisioning tests require loopback quieter_migration_test."
        );
      }
    });

    afterAll(async () => {
      const memberships = await db
        .select({ id: member.organizationId })
        .from(member)
        .where(inArray(member.userId, userIds));
      await db.delete(mailbox).where(inArray(mailbox.ownerUserId, userIds));
      await db
        .delete(organization)
        .where(
          inArray(organization.id, [
            ...organizationIds,
            ...memberships.map((row) => row.id),
          ])
        );
      await db.delete(user).where(inArray(user.id, userIds));
    });
    const createUser = async () => {
      const id = randomUUID();
      userIds.push(id);
      const identity = {
        email: `${id}@example.com`,
        id,
        name: "Provisioning fixture",
      };
      await db.insert(user).values({
        ...identity,
        createdAt: new Date(),
        emailVerified: true,
        updatedAt: new Date(),
      });
      return identity;
    };

    const login = async (email: string) => {
      await auth.handler(
        new Request("http://localhost:3000/api/auth/sign-in/magic-link", {
          body: JSON.stringify({
            callbackURL: "/",
            email,
            name: "Signup fixture",
          }),
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
          },
          method: "POST",
        })
      );
      const link = sendMagicLinkEmail.mock.calls.findLast(
        ([input]) => input.email === email
      )?.[0].url;
      if (link === undefined) {
        throw new Error("Missing fixture login link.");
      }
      const response = await auth.handler(new Request(link));
      return new Headers({
        cookie: response.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; "),
      });
    };

    test("first-time magic-link signup provisions an owner through the account hook", async () => {
      const headers = await login(`${randomUUID()}@example.com`);
      const current = await auth.api.getSession({ headers });
      if (current === null) {
        throw new Error("Missing signup session.");
      }
      userIds.push(current.user.id);
      await expect(
        db.select().from(member).where(eq(member.userId, current.user.id))
      ).resolves.toMatchObject([{ role: "owner" }]);
    });

    test("concurrent first-time bootstrap creates one owner and preserves the last-team leave guard", async () => {
      const identity = await createUser();
      const states = await Promise.all(
        Array.from(
          { length: 4 },
          async () => await ensureUserOrganizationState(identity)
        )
      );
      const memberships = await db
        .select()
        .from(member)
        .where(eq(member.userId, identity.id));
      expect(memberships).toHaveLength(1);
      expect(memberships[0]?.role).toBe("owner");
      for (const state of states) {
        expect(state.organizationIds).toContain(memberships[0]?.organizationId);
      }
      await expect(
        assertCanLeaveOrganization(
          identity,
          memberships[0]?.organizationId ?? ""
        )
      ).rejects.toMatchObject({ status: "BAD_REQUEST" });
    });

    test("supported owner removal survives active and fresh sessions, while an invitation can restore membership", async () => {
      const identity = await createUser();
      const secondOwner = await createUser();
      const state = await ensureUserOrganizationState(identity);
      const [organizationId] = state.organizationIds;
      if (organizationId === undefined) {
        throw new Error("Missing fixture team.");
      }
      organizationIds.push(organizationId);
      await db.insert(member).values({
        createdAt: new Date(),
        id: randomUUID(),
        organizationId,
        role: "owner",
        userId: secondOwner.id,
      });
      const activeSession = await login(identity.email);
      const ownerSession = await login(secondOwner.email);
      await auth.api.removeMember({
        body: { memberIdOrEmail: identity.email, organizationId },
        headers: ownerSession,
      });
      const { getSessionWithOrganization } = await import("../src/session");
      const active = await getSessionWithOrganization(activeSession);
      expect(active?.user.id).toBe(identity.id);
      await auth.handler(
        new Request("http://localhost:3000/api/auth/update-user", {
          body: JSON.stringify({
            defaultOrganizationProvisioned: false,
            name: identity.name,
          }),
          headers: {
            "content-type": "application/json",
            cookie: activeSession.get("cookie") ?? "",
            origin: "http://localhost:3000",
          },
          method: "POST",
        })
      );
      await expect(
        db
          .select({ provisioned: user.defaultOrganizationProvisioned })
          .from(user)
          .where(eq(user.id, identity.id))
      ).resolves.toMatchObject([{ provisioned: true }]);
      const freshSession = await login(identity.email);
      const fresh = await getSessionWithOrganization(freshSession);
      expect(fresh?.user.id).toBe(identity.id);
      await expect(
        db.select().from(member).where(eq(member.userId, identity.id))
      ).resolves.toHaveLength(0);
      const invitationId = randomUUID();
      await db.insert(invitation).values({
        createdAt: new Date(),
        email: identity.email,
        expiresAt: new Date(Date.now() + 60_000),
        id: invitationId,
        inviterId: secondOwner.id,
        organizationId,
        role: "member",
        status: "pending",
      });
      await auth.api.acceptInvitation({
        body: { invitationId },
        headers: freshSession,
      });
      await getSessionWithOrganization(freshSession);
      await expect(
        db.select().from(member).where(eq(member.userId, identity.id))
      ).resolves.toMatchObject([{ organizationId, role: "member" }]);
    });

    test("an existing invited membership is retained without owner promotion or a second team", async () => {
      const identity = await createUser();
      const organizationId = randomUUID();
      organizationIds.push(organizationId);
      await db.insert(organization).values({
        createdAt: new Date(),
        id: organizationId,
        name: "Inviting team",
        slug: organizationId,
      });
      await db.insert(member).values({
        createdAt: new Date(),
        id: randomUUID(),
        organizationId,
        role: "member",
        userId: identity.id,
      });
      await ensureUserOrganizationState(identity);
      await expect(
        db.select().from(member).where(eq(member.userId, identity.id))
      ).resolves.toMatchObject([{ organizationId, role: "member" }]);
      await db.delete(member).where(eq(member.userId, identity.id));
      const memberless = await ensureUserOrganizationState(identity);
      expect(memberless.organizationIds).toHaveLength(0);
    });

    test("failed owner insertion rolls back bootstrap and permits a complete retry", async () => {
      const identity = await createUser();
      const createdId = randomUUID();
      const idGenerator = vi
        .spyOn(crypto, "randomUUID")
        .mockReturnValueOnce(createdId)
        .mockImplementationOnce(() => {
          throw new Error("Injected owner insertion failure.");
        });
      try {
        await expect(ensureUserOrganizationState(identity)).rejects.toThrow(
          /Injected owner insertion failure/u
        );
      } finally {
        idGenerator.mockRestore();
      }
      await expect(
        db.select().from(organization).where(eq(organization.id, createdId))
      ).resolves.toHaveLength(0);
      await expect(
        db
          .select({ provisioned: user.defaultOrganizationProvisioned })
          .from(user)
          .where(eq(user.id, identity.id))
      ).resolves.toMatchObject([{ provisioned: false }]);
      const retried = await ensureUserOrganizationState(identity);
      expect(retried.organizationIds).toHaveLength(1);
    });

    test("a provisioned account without a team can create a team explicitly", async () => {
      const identity = await createUser();
      await db
        .update(user)
        .set({ defaultOrganizationProvisioned: true })
        .where(eq(user.id, identity.id));
      const headers = await login(identity.email);
      const { getSessionWithOrganization } = await import("../src/session");
      await getSessionWithOrganization(headers);
      const memberless = await ensureUserOrganizationState(identity);
      expect(memberless.organizationIds).toHaveLength(0);
      const created = await auth.api.createOrganization({
        body: { name: "Explicit team", slug: randomUUID() },
        headers,
      });
      if (created === null) {
        throw new Error("Missing explicitly created team.");
      }
      const explicit = await ensureUserOrganizationState(identity);
      expect(explicit.organizationIds).toContain(created.id);
      const other = await auth.api.createOrganization({
        body: { name: "Another explicit team", slug: randomUUID() },
        headers,
      });
      if (other === null) {
        throw new Error("Missing second team.");
      }
      const remainingOwner = await createUser();
      await db.insert(member).values({
        createdAt: new Date(),
        id: randomUUID(),
        organizationId: created.id,
        role: "owner",
        userId: remainingOwner.id,
      });
      await auth.api.leaveOrganization({
        body: { organizationId: created.id },
        headers,
      });
      const afterLeave = await ensureUserOrganizationState(identity);
      expect(afterLeave.organizationIds).not.toContain(created.id);
      expect(afterLeave.organizationIds).toContain(other.id);
      organizationIds.push(created.id);
    });

    test("migration preserves revocation for legacy memberless accounts and allows new-account bootstrap", async () => {
      const migration = readFileSync(
        new URL(
          "../../database/drizzle/20261029234010_lumpy_skullbuster/migration.sql",
          import.meta.url
        ),
        "utf8"
      );
      await db.transaction(async (transaction) => {
        await transaction.execute(
          sql`CREATE TEMP TABLE "user" (id text PRIMARY KEY) ON COMMIT DROP`
        );
        await transaction.execute(
          sql`INSERT INTO "user" (id) VALUES ('legacy-account')`
        );
        await transaction.execute(sql.raw(migration));
        await transaction.execute(
          sql`INSERT INTO "user" (id) VALUES ('new-account')`
        );
        const rows = await transaction.execute(
          sql`SELECT id, "defaultOrganizationProvisioned" FROM "user" ORDER BY id`
        );
        expect([...rows]).toMatchObject([
          { defaultOrganizationProvisioned: true, id: "legacy-account" },
          { defaultOrganizationProvisioned: false, id: "new-account" },
        ]);
      });
    });

    test("a colliding display slug cannot grant ownership of an existing team", async () => {
      const identity = await createUser();
      const victimId = randomUUID();
      organizationIds.push(victimId);
      await db.insert(organization).values({
        createdAt: new Date(),
        id: victimId,
        name: "Existing team",
        slug: createDefaultOrganizationName(identity),
      });
      const state = await ensureUserOrganizationState(identity);
      expect(state.organizationIds).not.toContain(victimId);
      const memberships = await db
        .select()
        .from(member)
        .where(eq(member.userId, identity.id));
      expect(memberships).toHaveLength(1);
      expect(memberships[0]).toMatchObject({
        role: "owner",
        userId: identity.id,
      });
    });

    test("removing the last membership cannot restore an owner on repeated provisioning", async () => {
      const identity = await createUser();
      const state = await ensureUserOrganizationState(identity);
      organizationIds.push(...state.organizationIds);
      await db.delete(member).where(eq(member.userId, identity.id));
      await ensureUserOrganizationState(identity);
      await ensureUserOrganizationState({
        ...identity,
        name: "Renamed account",
      });
      await expect(
        db.select().from(member).where(eq(member.userId, identity.id))
      ).resolves.toHaveLength(0);
    });
  }
);
