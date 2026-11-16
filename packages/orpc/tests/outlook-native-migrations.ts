import { readdirSync } from "node:fs";
import path from "node:path";

import postgres from "postgres";

import { runForwardMigrations } from "../../database/scripts/run-forward-migrations";

export default async function setup() {
  const workspace = process.cwd();
  process.umask(0o077);
  const value = process.env.DATABASE_URL;
  const run = process.env.QUIETER_OUTLOOK_NATIVE_RUN;
  if (!value || !run || !/^[a-f0-9]{12}$/u.test(run)) {
    throw new Error("Use the reviewed native214 runner.");
  }
  const target = new URL(value);
  if (
    target.protocol !== "postgresql:" ||
    target.hostname !== "127.0.0.1" ||
    !target.port ||
    ["5432", "6432"].includes(target.port) ||
    target.pathname !== `/quieter_outlook_native_214_${run}` ||
    target.username !== "outlook_fixture" ||
    !target.password ||
    target.search ||
    target.hash ||
    process.env.QUIETER_DEPLOYMENT_ENV !== "local" ||
    Object.keys(process.env).some((name) => name.startsWith("SST_RESOURCE_"))
  ) {
    throw new Error(
      "Migrations require the allocated disposable loopback database."
    );
  }

  const databaseDirectory = path.join(workspace, "packages/database");
  const client = postgres(value, { connect_timeout: 5, max: 1 });
  try {
    const [identity] = await client<
      { name: string; owner: string }[]
    >`select current_database() as name, current_user as owner`;
    if (
      identity?.name !== target.pathname.slice(1) ||
      identity?.owner !== "outlook_fixture"
    ) {
      throw new Error(
        "Actual database identity does not match the dedicated fixture."
      );
    }
    const relations = await client`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'drizzle') and c.relkind in ('r', 'p')
  `;
    if (relations.length !== 0) {
      throw new Error(
        "The native migration fixture must be fresh and empty; no reset is permitted."
      );
    }
  } finally {
    await client.end({ timeout: 3 });
  }

  const migrationsDirectory = path.join(databaseDirectory, "drizzle");
  await runForwardMigrations({
    databaseUrl: value,
    migrationsDirectory,
    packageDirectory: databaseDirectory,
  });

  const expected = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  const verify = postgres(value, { connect_timeout: 5, max: 1 });
  try {
    const applied = await verify<
      { name: string }[]
    >`select name from drizzle.__drizzle_migrations order by name`;
    if (
      applied.length !== expected.length ||
      applied.some((row, index) => row.name !== expected[index])
    ) {
      throw new Error(
        "The actual full migration ledger differs from the reviewed source."
      );
    }
    const [constraints] = await verify<{ count: number }[]>`
    select count(*)::int as count from pg_constraint
    where conname in ('outlook_credential_mailbox_owner_fk', 'outlook_oauth_state_mailbox_owner_fk', 'outlook_read_cursor_mailbox_owner_fk')
  `;
    if (constraints?.count !== 3) {
      throw new Error(
        "Required native owner compound foreign keys are absent."
      );
    }
    process.stdout.write(
      `${JSON.stringify({ applied: applied.length, compoundOwnerForeignKeys: constraints?.count, native214: "full-migrations" })}\n`
    );
  } finally {
    await verify.end({ timeout: 3 });
  }
}
