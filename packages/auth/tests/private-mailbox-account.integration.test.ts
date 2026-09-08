/// <reference types="node" />
import { randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import { mailbox, member, organization, user } from "@quieter/database/schema";
import { eq, inArray } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { cleanupOrganizationsForDeletedUser } from "../src/organization";

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
  "private mailbox account deletion",
  () => {
    const organizationId = randomUUID();
    const owner = randomUUID();
    const gmailOwner = randomUUID();
    const privateMailboxId = randomUUID();
    const gmailMailboxId = randomUUID();
    const now = new Date();
    beforeAll(async () => {
      const url = new URL(databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Account integration tests require loopback quieter_migration_test."
        );
      }
      await db.insert(user).values(
        [owner, gmailOwner].map((id) => ({
          createdAt: now,
          email: `${id}@example.com`,
          emailVerified: false,
          id,
          name: "Account fixture",
          updatedAt: now,
        }))
      );
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Account fixture",
        slug: organizationId,
      });
      await db.insert(member).values(
        [owner, gmailOwner].map((userId) => ({
          createdAt: now,
          id: randomUUID(),
          organizationId,
          role: "member",
          userId,
        }))
      );
      await db.insert(mailbox).values([
        {
          accessMode: "private",
          createdAt: now,
          emailAddress: `${privateMailboxId}@example.com`,
          id: privateMailboxId,
          managedOwnerUserId: owner,
          organizationId,
          provider: "managed",
          updatedAt: now,
        },
        {
          createdAt: now,
          emailAddress: `${gmailMailboxId}@example.com`,
          id: gmailMailboxId,
          organizationId,
          ownerUserId: gmailOwner,
          provider: "gmail",
          updatedAt: now,
        },
      ]);
    });

    afterAll(async () => {
      await db
        .delete(mailbox)
        .where(inArray(mailbox.id, [privateMailboxId, gmailMailboxId]));
      await db.delete(member).where(eq(member.organizationId, organizationId));
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(inArray(user.id, [owner, gmailOwner]));
    });

    test("rejects account deletion before removing team membership", async () => {
      await expect(
        cleanupOrganizationsForDeletedUser(owner)
      ).rejects.toMatchObject({ status: "FORBIDDEN" });
      await expect(
        db
          .select({ userId: member.userId })
          .from(member)
          .where(eq(member.userId, owner))
      ).resolves.toStrictEqual([{ userId: owner }]);
      await expect(
        db
          .select({ id: mailbox.id })
          .from(mailbox)
          .where(eq(mailbox.id, privateMailboxId))
      ).resolves.toStrictEqual([{ id: privateMailboxId }]);
    });

    test("personal Gmail cleanup still allows account deletion", async () => {
      await cleanupOrganizationsForDeletedUser(gmailOwner);

      await db.delete(user).where(eq(user.id, gmailOwner));
      await expect(
        db.select().from(mailbox).where(eq(mailbox.id, gmailMailboxId))
      ).resolves.toStrictEqual([]);
      await expect(
        db.select().from(user).where(eq(user.id, gmailOwner))
      ).resolves.toStrictEqual([]);
    });
  }
);
