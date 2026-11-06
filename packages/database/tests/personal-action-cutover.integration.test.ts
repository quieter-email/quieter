import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import postgres from "postgres";
import { describe, expect, test } from "vite-plus/test";

import { assertLocalDatabaseUrl } from "../scripts/local-development.ts";
import {
  assertPersonalActionCutover,
  getPersonalActionCutoverStatus,
  PERSONAL_ACTION_MIGRATIONS,
  preparePersonalActionCutover,
  releasePersonalActionCutover,
} from "../scripts/personal-action-cutover.ts";
import { runForwardMigrations } from "../scripts/run-forward-migrations.ts";

const databaseUrl = process.env.ACTION_CUTOVER_TEST_DATABASE_URL;
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const migrationsDirectory = path.join(packageDirectory, "drizzle");

describe("database Action cutover", () => {
  test.skipIf(databaseUrl === undefined)(
    "Action cutover rejects old SQL, preserves effects, resumes and releases marked transactions",
    async () => {
      if (!databaseUrl) {
        throw new Error("A disposable cutover database is required");
      }
      assertLocalDatabaseUrl(databaseUrl, "quieter_cutover_test");
      const owner = postgres(databaseUrl, { max: 1, onnotice: () => {} });
      const temporaryDirectory = mkdtempSync(
        path.join(tmpdir(), "quieter-action-cutover-")
      );
      const previousDatabaseUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = databaseUrl;
      const runtimeRole = `cutover_test_${crypto.randomUUID().replaceAll("-", "")}`;
      const runtimeUrl = new URL(databaseUrl);
      runtimeUrl.username = runtimeRole;
      runtimeUrl.password = "cutover-test";
      const old = postgres(runtimeUrl.toString(), {
        max: 1,
        onnotice: () => {},
      });
      const build = { buildId: "cutover-build", workflowIdentity: "test/1" };
      try {
        await owner`DROP SCHEMA IF EXISTS drizzle CASCADE`;
        await owner`DROP SCHEMA public CASCADE`;
        await owner`CREATE SCHEMA public`;
        const prefix = path.join(temporaryDirectory, "drizzle");
        for (const entry of readdirSync(migrationsDirectory, {
          withFileTypes: true,
        })) {
          if (
            entry.isDirectory() &&
            entry.name < PERSONAL_ACTION_MIGRATIONS[0]
          ) {
            cpSync(
              path.join(migrationsDirectory, entry.name),
              path.join(prefix, entry.name),
              { recursive: true }
            );
          }
        }
        await runForwardMigrations({
          databaseUrl,
          migrationsDirectory: prefix,
          packageDirectory,
        });
        await owner`INSERT INTO public."user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ('actor', 'Synthetic actor', 'actor@example.test', true, now(), now())`;
        await owner`INSERT INTO public.organization (id, name, slug, "createdAt") VALUES ('org', 'Synthetic team', 'cutover-team', now())`;
        await owner`INSERT INTO public.member (id, "userId", "organizationId", role, "createdAt") VALUES ('membership', 'actor', 'org', 'owner', now() - interval '1 day')`;
        await owner`INSERT INTO public.mailbox (id, "organizationId", provider, "accessMode", "emailAddress", "createdAt", "updatedAt") VALUES
      ('inbox', 'org', 'managed', 'shared', 'inbox@example.test', now(), now()), ('cascade-inbox', 'org', 'managed', 'shared', 'cascade@example.test', now(), now())`;
        await owner`INSERT INTO public."mailboxAgentRevision" (id, "mailboxId", "createdByUserId", "createdAt", manifest, "manifestDigest", specification) VALUES ('review', 'inbox', 'actor', now(), '{}', 'digest', '{}')`;
        await owner`INSERT INTO public."mailboxAgentSetting" ("mailboxId", "activatedByUserId", "activeRevisionId", "draftRevisionId", "activatedAt", enabled, "createdAt", "updatedAt") VALUES
      ('inbox', 'actor', 'review', 'review', now(), true, now(), now()), ('cascade-inbox', NULL, NULL, NULL, NULL, false, now(), now())`;
        await owner`INSERT INTO public."mailboxGrant" (id, "mailboxId", "userId", role, "createdAt", "updatedAt") VALUES ('grant', 'inbox', 'actor', 'manager', now(), now())`;
        await owner`INSERT INTO public."mailboxAgentRun" (id, "mailboxId", "actorUserId", "revisionId", "settingVersion", "invocationKey", "threadId", "triggerKind", status, attempts, "leaseToken", "leaseExpiresAt", "createdAt", "updatedAt") VALUES
      ('no-effect', 'inbox', 'actor', 'review', 0, 'no-effect', 'thread', 'manual', 'running', 2, 'old-lease-1', now() + interval '1 minute', now(), now()),
      ('with-effect', 'inbox', 'actor', 'review', 0, 'with-effect', 'thread', 'manual', 'running', 1, 'old-lease-2', now() + interval '1 minute', now(), now())`;
        await owner.unsafe(
          `CREATE ROLE "${runtimeRole}" LOGIN PASSWORD 'cutover-test'`
        );
        await owner.unsafe(`GRANT USAGE ON SCHEMA public TO "${runtimeRole}"`);
        await owner.unsafe(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${runtimeRole}"`
        );
        const effectInserted = Promise.withResolvers<boolean>();
        const effectMayCommit = Promise.withResolvers<boolean>();
        const oldEffect = old.begin(async (transaction) => {
          await transaction`INSERT INTO public."mailboxAgentEffect" (id, "mailboxId", "runId", "toolCallId", "toolId", "inputDigest", status, result, "createdAt", "updatedAt") VALUES ('effect', 'inbox', 'with-effect', 'call', 'fake.write', 'digest', 'pending', '{"preserved":true}', now(), now())`;
          effectInserted.resolve(true);
          await effectMayCommit.promise;
        });
        await effectInserted.promise;
        let prepared = false;
        const preparation = preparePersonalActionCutover(owner, build).then(
          (result) => {
            prepared = true;
            return result;
          }
        );
        await setTimeout(50);
        expect(prepared).toBeFalsy();
        effectMayCommit.resolve(true);
        await oldEffect;
        await preparation;
        await expect(
          owner`SELECT id, status, attempts, "leaseToken", "leaseExpiresAt" FROM public."mailboxAgentRun" ORDER BY id`
        ).resolves.toStrictEqual(
          expect.arrayContaining([
            expect.objectContaining({
              attempts: 1,
              id: "no-effect",
              leaseExpiresAt: null,
              leaseToken: null,
              status: "queued",
            }),
            expect.objectContaining({
              attempts: 1,
              id: "with-effect",
              leaseExpiresAt: null,
              leaseToken: null,
              status: "needs_attention",
            }),
          ])
        );
        await expect(
          owner`SELECT status, result FROM public."mailboxAgentEffect"`
        ).resolves.toMatchObject([
          { result: { preserved: true }, status: "uncertain" },
        ]);
        await preparePersonalActionCutover(owner, build);
        await expect(
          owner`SELECT attempts FROM public."mailboxAgentRun" WHERE id = 'no-effect'`
        ).resolves.toMatchObject([{ attempts: 1 }]);
        await expect(
          old`UPDATE public."mailboxAgentSetting" SET enabled = false WHERE "mailboxId" = 'inbox'`
        ).rejects.toMatchObject({
          code: "55000",
          constraint_name: "quieter_action_cutover",
        });
        await expect(
          old`DELETE FROM public."mailboxGrant" WHERE id = 'grant'`
        ).rejects.toMatchObject({ code: "55000" });
        await expect(
          old`INSERT INTO public."mailboxAgentEffect" (id, "mailboxId", "runId", "toolCallId", "toolId", "inputDigest", status, "createdAt", "updatedAt") VALUES ('late-old-effect', 'inbox', 'no-effect', 'late-old-call', 'fake.write', 'digest', 'pending', now(), now())`
        ).rejects.toMatchObject({ code: "55000" });
        await expect(
          old.begin(async (transaction) => {
            await transaction`SELECT set_config('quieter.action_protocol', 'personal-actions-v1', true)`;
            await transaction`UPDATE public."mailboxAgentRun" SET status = 'running', "leaseToken" = 'new-lease' WHERE id = 'no-effect'`;
          })
        ).rejects.toMatchObject({ code: "55000" });
        await expect(
          old.begin(async (transaction) => {
            await transaction`SELECT set_config('quieter.action_cutover', 'maintenance', true)`;
            await transaction`UPDATE public."mailboxAgentSetting" SET enabled = false WHERE "mailboxId" = 'inbox'`;
          })
        ).rejects.toMatchObject({ code: "55000" });
        await expect(
          preparePersonalActionCutover(owner, {
            ...build,
            buildId: "successor",
          })
        ).rejects.toThrow("different build");
        await preparePersonalActionCutover(owner, {
          ...build,
          buildId: "successor",
          expectedPreviousBuildId: build.buildId,
        });
        await runForwardMigrations(
          { databaseUrl, migrationsDirectory, packageDirectory },
          { GITHUB_SHA: "successor" }
        );
        await assertPersonalActionCutover(owner, {
          buildId: "successor",
          phase: "fenced",
          requirePersonalTable: true,
        });
        await expect(
          owner`SELECT enabled, "activeRevisionId", "memberId" FROM public."mailboxPersonalAgentSetting"`
        ).resolves.toMatchObject([
          { activeRevisionId: "review", enabled: true, memberId: "membership" },
        ]);
        await expect(
          owner`SELECT enabled FROM public."mailboxAgentSetting" WHERE "mailboxId" = 'inbox'`
        ).resolves.toMatchObject([{ enabled: true }]);
        const ledger = await owner<
          { name: string; hash: string }[]
        >`SELECT name, hash FROM drizzle.__drizzle_migrations`;
        for (const name of PERSONAL_ACTION_MIGRATIONS) {
          expect(ledger.find((row) => row.name === name)?.hash).toBe(
            createHash("sha256")
              .update(
                readFileSync(
                  path.join(migrationsDirectory, name, "migration.sql")
                )
              )
              .digest("hex")
          );
        }
        await owner.unsafe(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON public."mailboxPersonalAgentSetting" TO "${runtimeRole}"`
        );
        await expect(
          old`UPDATE public."mailboxPersonalAgentSetting" SET enabled = false`
        ).rejects.toMatchObject({ code: "55000" });
        await expect(
          releasePersonalActionCutover(owner, {
            ...build,
            buildId: "successor",
            verifiedDeploymentBuildId: "other",
          })
        ).rejects.toThrow("does not match");
        await releasePersonalActionCutover(owner, {
          ...build,
          buildId: "successor",
          verifiedDeploymentBuildId: "successor",
        });
        await expect(
          old`INSERT INTO public."mailboxGrant" (id, "mailboxId", "userId", role, "memberId", "createdAt", "updatedAt") VALUES ('old-upsert', 'inbox', 'actor', 'manager', 'membership', now(), now()) ON CONFLICT ("mailboxId", "userId") DO UPDATE SET role = EXCLUDED.role`
        ).rejects.toMatchObject({ code: "55000" });
        await expect(
          old`UPDATE public."mailboxGrant" SET role = 'responder' WHERE id = 'grant'`
        ).rejects.toMatchObject({ code: "55000" });
        await expect(
          old`DELETE FROM public."mailboxGrant" WHERE id = 'grant'`
        ).rejects.toMatchObject({ code: "55000" });
        await releasePersonalActionCutover(owner, {
          ...build,
          buildId: "successor",
          verifiedDeploymentBuildId: "successor",
        });
        await expect(
          old`UPDATE public."mailboxAgentRun" SET status = 'running', "leaseToken" = 'old-runtime' WHERE id = 'no-effect'`
        ).rejects.toMatchObject({ code: "55000" });
        await expect(
          old`INSERT INTO public."mailboxAgentRun" (id, "mailboxId", "actorUserId", "revisionId", "settingVersion", "invocationKey", "threadId", "triggerKind", "createdAt", "updatedAt") VALUES ('old-enqueue', 'inbox', 'actor', 'review', 0, 'old-enqueue', 'thread', 'mail_received', now(), now())`
        ).rejects.toMatchObject({ code: "55000" });
        await expect(
          old`UPDATE public.mailbox SET "divisionId" = 'missing' WHERE id = 'inbox'`
        ).rejects.toMatchObject({ code: "55000" });
        await old`UPDATE public.mailbox SET "displayName" = 'Ordinary metadata' WHERE id = 'inbox'`;
        await old.begin(async (transaction) => {
          await transaction`SELECT set_config('quieter.action_protocol', 'personal-actions-v1', true)`;
          await transaction`UPDATE public."mailboxPersonalAgentSetting" SET enabled = false WHERE "mailboxId" = 'inbox'`;
          await transaction`UPDATE public."mailboxAgentRun" SET status = 'running', "leaseToken" = 'new-runtime' WHERE id = 'no-effect'`;
          await transaction`INSERT INTO public."mailboxAgentEffect" (id, "mailboxId", "runId", "toolCallId", "toolId", "inputDigest", status, "createdAt", "updatedAt") VALUES ('new-effect', 'inbox', 'no-effect', 'new-call', 'fake.write', 'digest', 'pending', now(), now())`;
          await transaction`UPDATE public."mailboxGrant" SET role = 'reader' WHERE id = 'grant'`;
        });
        await expect(
          old`UPDATE public."mailboxPersonalAgentSetting" SET enabled = true`
        ).rejects.toMatchObject({ code: "55000" });
        await expect(
          old`UPDATE public."mailboxAgentSetting" SET enabled = false WHERE "mailboxId" = 'inbox'`
        ).rejects.toMatchObject({ code: "55000" });
        await runForwardMigrations(
          { databaseUrl, migrationsDirectory, packageDirectory },
          { GITHUB_SHA: "successor" }
        );
        await expect(
          owner`SELECT enabled FROM public."mailboxPersonalAgentSetting"`
        ).resolves.toMatchObject([{ enabled: false }]);
        await old`DELETE FROM public.member WHERE id = 'membership'`;
        await expect(
          owner`SELECT id FROM public."mailboxGrant"`
        ).resolves.toHaveLength(0);
        await expect(
          owner`SELECT "userId" FROM public."mailboxPersonalAgentSetting"`
        ).resolves.toHaveLength(0);
        await old`DELETE FROM public.mailbox WHERE id = 'cascade-inbox'`;
        await expect(
          owner`SELECT "mailboxId" FROM public."mailboxAgentSetting" WHERE "mailboxId" = 'cascade-inbox'`
        ).resolves.toHaveLength(0);
        await owner`ALTER TABLE public."mailboxAgentRun" DISABLE TRIGGER quieter_action_cutover`;
        await expect(assertPersonalActionCutover(owner)).rejects.toThrow(
          "missing or changed"
        );
        await expect(
          getPersonalActionCutoverStatus(owner)
        ).resolves.toMatchObject({
          pending: false,
          required: false,
          state: { buildId: "successor", phase: "ready" },
        });
      } finally {
        await old.end();
        await owner.unsafe(`DROP OWNED BY "${runtimeRole}"`).catch(() => {});
        await owner.unsafe(`DROP ROLE IF EXISTS "${runtimeRole}"`);
        await owner.end();
        rmSync(temporaryDirectory, {
          force: true,
          maxRetries: 3,
          recursive: true,
        });
        if (previousDatabaseUrl === undefined) {
          delete process.env.DATABASE_URL;
        } else {
          process.env.DATABASE_URL = previousDatabaseUrl;
        }
      }
    },
    120_000
  );
});
