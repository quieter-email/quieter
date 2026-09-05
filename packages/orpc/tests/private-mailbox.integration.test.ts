/// <reference types="node" />

import { randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import {
  mailbox,
  mailboxGrant,
  mailboxDivisionGrant,
  mailDomain,
  member,
  organization,
  organizationDivision,
  organizationDivisionMember,
  user,
} from "@quieter/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { getAuthorizedManagedMailbox } from "../src/mailbox/access";
import {
  createManagedMailbox,
  setManagedMailboxAccessMode,
  setManagedMailboxGrant,
  setManagedMailboxDivisionGrant,
  removeManagedMailboxGrant,
} from "../src/mailbox/managed-grants";

const { databaseUrl } = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
}));
vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    serverEnv: { ...original.serverEnv, DATABASE_URL: databaseUrl },
  };
});

describe.skipIf(databaseUrl === undefined)(
  "private mailbox persistence on migrated PostgreSQL",
  () => {
    const organizationId = randomUUID();
    const admin = randomUUID();
    const owner = randomUUID();
    const other = randomUUID();
    const outsider = randomUUID();
    const divisionId = randomUUID();
    const domain = `${randomUUID()}.example.com`;
    const mailboxIds: string[] = [];
    const now = new Date();
    const create = async (accessMode: "private" | "shared" = "private") => {
      const result = await createManagedMailbox({
        accessMode,
        emailAddress: `${randomUUID()}@${domain}`,
        organizationId,
        ownerUserId: accessMode === "private" ? owner : null,
        userId: admin,
      });
      mailboxIds.push(result.mailboxId);
      return result.mailboxId;
    };
    beforeAll(async () => {
      const url = new URL(databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Mailbox integration tests require loopback quieter_migration_test."
        );
      }
      await db.insert(user).values(
        [admin, owner, other, outsider].map((id) => ({
          createdAt: now,
          email: `${id}@example.com`,
          emailVerified: false,
          id,
          name: "Mailbox fixture",
          updatedAt: now,
        }))
      );
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Mailbox fixture",
        slug: organizationId,
      });
      await db.insert(member).values(
        [admin, owner, other].map((id) => ({
          createdAt: now,
          id: randomUUID(),
          organizationId,
          role: id === admin ? "admin" : "member",
          userId: id,
        }))
      );
      await db.insert(mailDomain).values({
        createdAt: now,
        domain,
        id: randomUUID(),
        mailFromDomain: `bounce.${domain}`,
        mode: "send_and_receive",
        organizationId,
        requiredDnsRecords: [],
        status: "verified",
        updatedAt: now,
      });
      await db.insert(organizationDivision).values({
        createdAt: now,
        id: divisionId,
        name: "Fixture",
        normalizedName: "fixture",
        organizationId,
        updatedAt: now,
      });
      const [otherMember] = await db
        .select({ id: member.id })
        .from(member)
        .where(eq(member.userId, other));
      if (otherMember === undefined) {
        throw new Error("Missing fixture member");
      }
      await db.insert(organizationDivisionMember).values({
        createdAt: now,
        divisionId,
        id: randomUUID(),
        memberId: otherMember.id,
      });
    });

    afterAll(async () => {
      if (mailboxIds.length > 0) {
        await db
          .delete(mailboxDivisionGrant)
          .where(inArray(mailboxDivisionGrant.mailboxId, mailboxIds));
        await db
          .delete(mailboxGrant)
          .where(inArray(mailboxGrant.mailboxId, mailboxIds));
        await db.delete(mailbox).where(inArray(mailbox.id, mailboxIds));
      }
      await db
        .delete(organizationDivisionMember)
        .where(eq(organizationDivisionMember.divisionId, divisionId));
      await db
        .delete(organizationDivision)
        .where(eq(organizationDivision.id, divisionId));
      await db
        .delete(mailDomain)
        .where(eq(mailDomain.organizationId, organizationId));
      await db.delete(member).where(eq(member.organizationId, organizationId));
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db
        .delete(user)
        .where(inArray(user.id, [admin, owner, other, outsider]));
    });

    test("creates exactly one owner grant without granting the creating admin or team", async () => {
      const mailboxId = await create();
      await expect(
        db
          .select({ role: mailboxGrant.role, userId: mailboxGrant.userId })
          .from(mailboxGrant)
          .where(eq(mailboxGrant.mailboxId, mailboxId))
      ).resolves.toStrictEqual([{ role: "manager", userId: owner }]);
      await expect(
        getAuthorizedManagedMailbox({ mailboxId, userId: owner })
      ).resolves.toMatchObject({ organizationId, role: "manager" });
      await expect(
        getAuthorizedManagedMailbox({ mailboxId, userId: admin })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        getAuthorizedManagedMailbox({ mailboxId, userId: other })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        setManagedMailboxGrant({
          mailboxId,
          role: "reader",
          targetUserId: outsider,
          userId: admin,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    test("revokes offboarded ownership even when the owner grant is missing", async () => {
      const mailboxId = await create();
      await db
        .delete(mailboxGrant)
        .where(eq(mailboxGrant.mailboxId, mailboxId));
      await expect(
        getAuthorizedManagedMailbox({ mailboxId, userId: owner })
      ).resolves.toMatchObject({ role: "manager" });
      const [membership] = await db
        .delete(member)
        .where(
          and(
            eq(member.userId, owner),
            eq(member.organizationId, organizationId)
          )
        )
        .returning();
      try {
        await expect(
          getAuthorizedManagedMailbox({ mailboxId, userId: owner })
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          setManagedMailboxGrant({
            mailboxId,
            role: "manager",
            targetUserId: other,
            userId: owner,
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      } finally {
        if (membership !== undefined) {
          await db.insert(member).values(membership);
        }
      }
    });

    test("explicit grants preserve roles and owner authority cannot be downgraded", async () => {
      const mailboxId = await create();
      await setManagedMailboxGrant({
        mailboxId,
        role: "reader",
        targetUserId: other,
        userId: owner,
      });
      await expect(
        getAuthorizedManagedMailbox({ mailboxId, userId: other })
      ).resolves.toMatchObject({ role: "reader" });
      await expect(
        getAuthorizedManagedMailbox({
          mailboxId,
          requiredRoles: ["responder"],
          userId: other,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        removeManagedMailboxGrant({
          mailboxId,
          targetUserId: owner,
          userId: admin,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        setManagedMailboxGrant({
          mailboxId,
          role: "reader",
          targetUserId: owner,
          userId: admin,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    test("privatization resets direct and division grants, and transfer replaces the owner", async () => {
      const mailboxId = await create("shared");
      await setManagedMailboxDivisionGrant({
        divisionId,
        mailboxId,
        role: "reader",
        userId: admin,
      });
      await expect(
        getAuthorizedManagedMailbox({ mailboxId, userId: other })
      ).resolves.toMatchObject({ role: "reader" });
      await setManagedMailboxAccessMode({
        accessMode: "private",
        mailboxId,
        ownerUserId: owner,
        userId: admin,
      });
      await expect(
        getAuthorizedManagedMailbox({ mailboxId, userId: admin })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        getAuthorizedManagedMailbox({ mailboxId, userId: other })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test("only an admin can transfer ownership and previous access is removed", async () => {
      const mailboxId = await create();
      await expect(
        setManagedMailboxAccessMode({
          accessMode: "private",
          mailboxId,
          ownerUserId: other,
          userId: owner,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await setManagedMailboxAccessMode({
        accessMode: "private",
        mailboxId,
        ownerUserId: other,
        userId: admin,
      });
      await expect(
        getAuthorizedManagedMailbox({ mailboxId, userId: other })
      ).resolves.toMatchObject({ role: "manager" });
      await expect(
        getAuthorizedManagedMailbox({ mailboxId, userId: owner })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test("sharing preserves explicit access without granting the whole team", async () => {
      const mailboxId = await create();
      await setManagedMailboxGrant({
        mailboxId,
        role: "reader",
        targetUserId: other,
        userId: owner,
      });
      await setManagedMailboxAccessMode({
        accessMode: "shared",
        mailboxId,
        userId: owner,
      });
      await expect(
        getAuthorizedManagedMailbox({ mailboxId, userId: owner })
      ).resolves.toMatchObject({ role: "manager" });
      await expect(
        getAuthorizedManagedMailbox({ mailboxId, userId: other })
      ).resolves.toMatchObject({ role: "reader" });
      await expect(
        getAuthorizedManagedMailbox({ mailboxId, userId: admin })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test("concurrent owner changes leave only the final owner's grant", async () => {
      const mailboxId = await create("shared");
      await Promise.all(
        [owner, other].map(
          async (ownerUserId) =>
            await setManagedMailboxAccessMode({
              accessMode: "private",
              mailboxId,
              ownerUserId,
              userId: admin,
            })
        )
      );
      const [result] = await db
        .select({ ownerUserId: mailbox.managedOwnerUserId })
        .from(mailbox)
        .where(eq(mailbox.id, mailboxId));
      await expect(
        db
          .select({ userId: mailboxGrant.userId })
          .from(mailboxGrant)
          .where(eq(mailboxGrant.mailboxId, mailboxId))
      ).resolves.toStrictEqual([{ userId: result?.ownerUserId }]);
    });

    test("concurrent division grants cannot revive when a private mailbox becomes shared", async () => {
      const mailboxId = await create("shared");
      await Promise.allSettled([
        setManagedMailboxAccessMode({
          accessMode: "private",
          mailboxId,
          ownerUserId: owner,
          userId: admin,
        }),
        setManagedMailboxDivisionGrant({
          divisionId,
          mailboxId,
          role: "reader",
          userId: admin,
        }),
      ]);
      const [result] = await db
        .select({ accessMode: mailbox.accessMode })
        .from(mailbox)
        .where(eq(mailbox.id, mailboxId));
      expect(result?.accessMode).toBe("private");
      await setManagedMailboxAccessMode({
        accessMode: "shared",
        mailboxId,
        userId: admin,
      });
      await expect(
        db
          .select()
          .from(mailboxDivisionGrant)
          .where(eq(mailboxDivisionGrant.mailboxId, mailboxId))
      ).resolves.toStrictEqual([]);
      await expect(
        getAuthorizedManagedMailbox({ mailboxId, userId: other })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test("database prevents owner-account deletion from cascading into team mail", async () => {
      const mailboxId = await create();
      await expect(
        db.delete(user).where(eq(user.id, owner))
      ).rejects.toMatchObject({ cause: { code: "23001" } });
      await expect(
        db
          .select({ id: mailbox.id })
          .from(mailbox)
          .where(eq(mailbox.id, mailboxId))
      ).resolves.toStrictEqual([{ id: mailboxId }]);
    });
  }
);
