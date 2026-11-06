import { readFile } from "node:fs/promises";

import postgres from "postgres";
import { describe, expect, test } from "vite-plus/test";

import { assertLocalDatabaseUrl } from "../scripts/local-development";

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;
type Setting = {
  mailboxId: string;
  enabled: boolean;
  activeRevisionId: string | null;
  activatedAt: Date | null;
  draftRevisionId: string;
  version: number;
  activationVersion: number;
};

describe("pre-membership authority migration", () => {
  test.skipIf(databaseUrl === undefined)(
    "migration invalidates authority predating membership and preserves explicit current authorization",
    async () => {
      if (databaseUrl === undefined) {
        throw new Error("A disposable migration database is required.");
      }
      assertLocalDatabaseUrl(databaseUrl, "quieter_migration_test");
      const connection = postgres(databaseUrl, { max: 1 });
      const migration = await readFile(
        new URL(
          "../drizzle/20261104170538_invalidate_pre_membership_authority/migration.sql",
          import.meta.url
        ),
        "utf8"
      );
      try {
        await connection.begin(async (tx) => {
          await tx`CREATE TEMP TABLE mailbox (id text PRIMARY KEY, "organizationId" text NOT NULL, provider text NOT NULL) ON COMMIT DROP`;
          await tx`CREATE TEMP TABLE member (id text PRIMARY KEY, "userId" text NOT NULL, "organizationId" text NOT NULL, "createdAt" timestamp NOT NULL) ON COMMIT DROP`;
          await tx`CREATE TEMP TABLE "mailboxGrant" (id text PRIMARY KEY, "mailboxId" text NOT NULL, "memberId" text, "userId" text NOT NULL, "createdAt" timestamp NOT NULL, "updatedAt" timestamp NOT NULL) ON COMMIT DROP`;
          await tx`CREATE TEMP TABLE "mailboxPersonalAgentSetting" ("mailboxId" text PRIMARY KEY, "memberId" text, "userId" text NOT NULL, enabled boolean NOT NULL, "activeRevisionId" text, "draftRevisionId" text, "activatedAt" timestamp, version integer NOT NULL, "activationVersion" integer NOT NULL) ON COMMIT DROP`;
          await tx`INSERT INTO member VALUES ('current-member', 'actor', 'team', '2026-10-10')`;
          await tx`INSERT INTO mailbox VALUES
          ('stale', 'team', 'managed'), ('missing-time', 'team', 'managed'),
          ('current', 'team', 'managed'), ('equal-time', 'team', 'managed'),
          ('inactive', 'team', 'managed'), ('personal-gmail', 'team', 'gmail')`;
          await tx`INSERT INTO "mailboxGrant" VALUES
          ('stale-grant', 'stale', 'current-member', 'actor', '2026-10-01', '2026-10-05'),
          ('explicit-regrant', 'current', 'current-member', 'actor', '2026-10-01', '2026-10-15'),
          ('equal-time-grant', 'equal-time', 'current-member', 'actor', '2026-10-10', '2026-10-10')`;
          await tx`INSERT INTO "mailboxPersonalAgentSetting" VALUES
          ('stale', 'current-member', 'actor', true, 'old-review', 'private-draft', '2026-10-05', 4, 1),
          ('missing-time', 'current-member', 'actor', true, 'old-review', 'private-draft', NULL, 4, 1),
          ('current', 'current-member', 'actor', true, 'new-review', 'private-draft', '2026-10-15', 4, 1),
          ('equal-time', 'current-member', 'actor', true, 'new-review', 'private-draft', '2026-10-10', 4, 1),
          ('inactive', 'current-member', 'actor', false, NULL, 'private-draft', NULL, 4, 1),
          ('personal-gmail', NULL, 'actor', true, 'old-review', 'private-draft', '2026-10-05', 4, 1)`;
          const before = await tx<
            Setting[]
          >`SELECT * FROM "mailboxPersonalAgentSetting"`;
          for (const statement of migration.split("--> statement-breakpoint")) {
            // oxlint-disable-next-line eslint/no-await-in-loop -- Apply the real migration statements in their reviewed order.
            await tx.unsafe(statement);
          }
          const grants = await tx<
            { id: string; memberId: string | null }[]
          >`SELECT id, "memberId" FROM "mailboxGrant"`;
          expect(grants).toStrictEqual(
            expect.arrayContaining([
              { id: "stale-grant", memberId: null },
              { id: "explicit-regrant", memberId: "current-member" },
              { id: "equal-time-grant", memberId: "current-member" },
            ])
          );
          const settings = await tx<
            Setting[]
          >`SELECT * FROM "mailboxPersonalAgentSetting"`;
          const stale = settings.filter((setting) =>
            ["stale", "missing-time"].includes(setting.mailboxId)
          );
          expect(stale).toHaveLength(2);
          for (const setting of stale) {
            const previous = before.find(
              (row) => row.mailboxId === setting.mailboxId
            );
            if (previous === undefined) {
              throw new Error("Missing baseline setting.");
            }
            expect(setting.draftRevisionId).toBe(previous.draftRevisionId);
            expect(setting).toMatchObject({
              activatedAt: null,
              activeRevisionId: null,
              enabled: false,
            });
            expect(setting.version).toBe(previous.version + 1);
            expect(setting.activationVersion).toBe(
              previous.activationVersion + 1
            );
          }
          for (const setting of settings.filter(
            (candidate) => !stale.includes(candidate)
          )) {
            const previous = before.find(
              (row) => row.mailboxId === setting.mailboxId
            );
            if (previous === undefined) {
              throw new Error("Missing baseline setting.");
            }
            expect(setting).toMatchObject(previous);
          }
        });
      } finally {
        await connection.end();
      }
    }
  );
});
