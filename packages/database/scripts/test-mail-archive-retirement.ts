import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type postgres from "postgres";

const migration = readFileSync(
  new URL(
    "../drizzle/20261110114446_retire_archive_rules/migration.sql",
    import.meta.url
  ),
  "utf-8"
);

const constraintsMigration = readFileSync(
  new URL(
    "../drizzle/20261110115212_cute_yellow_claw/migration.sql",
    import.meta.url
  ),
  "utf-8"
);

export const testMailArchiveRetirement = async (sql: postgres.Sql) => {
  await sql.begin(async (tx) => {
    await tx`CREATE TEMP TABLE "managedMailRule" (
      id text PRIMARY KEY, actions jsonb, enabled boolean NOT NULL,
      "disabledReason" text, "updatedAt" timestamp NOT NULL DEFAULT now()
    ) ON COMMIT DROP`;
    await tx`CREATE TEMP TABLE "managedMailRuleBackfill" (
      id text PRIMARY KEY, "ruleId" text NOT NULL, definition jsonb,
      status text NOT NULL, "cancelledAt" timestamp, "leaseId" text,
      "leasedUntil" timestamp, "lastError" text,
      "updatedAt" timestamp NOT NULL DEFAULT now()
    ) ON COMMIT DROP`;
    await tx`CREATE TEMP TABLE "managedMailRuleRun" (
      id text PRIMARY KEY, "ruleId" text NOT NULL, definition jsonb NOT NULL,
      revision text NOT NULL, "actionResults" jsonb NOT NULL,
      "completedAt" timestamp, error text,
      "updatedAt" timestamp NOT NULL DEFAULT now()
    ) ON COMMIT DROP`;

    const archive = { destination: "archive", kind: "move" };
    const label = { addIds: ["label"], kind: "set-labels", removeIds: [] };
    const read = { kind: "set-read", read: true };
    const forward = {
      includeAttachments: false,
      kind: "forward",
      recipients: ["recipient@example.test"],
    };
    const snapshot = {
      conditionGroups: [],
      enabled: true,
      id: "mixed",
      labelIds: [],
      matchMode: "all",
      name: "Existing rule",
      ownerUserId: null,
      revision: "original-revision",
      search: { filters: [], text: "" },
    };
    const mixed = { ...snapshot, actions: [label, archive, read] };
    const onlyArchive = { ...snapshot, actions: [archive], id: "only-archive" };
    await tx`INSERT INTO "managedMailRule" (id, actions, enabled, "disabledReason") VALUES
      ('mixed', ${JSON.stringify(mixed.actions)}::text::jsonb, true, null),
      ('only-archive', ${JSON.stringify(onlyArchive.actions)}::text::jsonb, true, null),
      ('unrelated', ${JSON.stringify([read])}::text::jsonb, true, null),
      ('disabled', ${JSON.stringify([archive, read])}::text::jsonb, false, 'Owner disabled')`;
    await tx`INSERT INTO "managedMailRuleBackfill" (id, "ruleId", definition, status, "leaseId", "leasedUntil") VALUES
      ('mixed-job', 'mixed', ${JSON.stringify(mixed)}::text::jsonb, 'running', 'lease', now()),
      ('archive-job', 'only-archive', ${JSON.stringify(onlyArchive)}::text::jsonb, 'pending', null, null),
      ('inherited-job', 'only-archive', null, 'running', 'old-lease', now()),
      ('unrelated-job', 'unrelated', ${JSON.stringify({ ...snapshot, actions: [read] })}::text::jsonb, 'pending', null, null)`;
    await tx`INSERT INTO "managedMailRuleRun" (id, "ruleId", definition, revision, "actionResults", "completedAt") VALUES
      ('resume', 'mixed', ${JSON.stringify(mixed)}::text::jsonb, 'original-revision', ${JSON.stringify(
        [
          { kind: "set-labels", status: "applied" },
          { kind: "move", status: "applied" },
        ]
      )}::text::jsonb, null),
      ('history', 'mixed', ${JSON.stringify(mixed)}::text::jsonb, 'original-revision', ${JSON.stringify(
        [
          { kind: "set-labels", status: "applied" },
          { kind: "move", status: "applied" },
          { kind: "set-read", status: "applied" },
        ]
      )}::text::jsonb, now()),
      ('only-archive-run', 'only-archive', ${JSON.stringify(onlyArchive)}::text::jsonb, 'original-revision', ${JSON.stringify([])}::text::jsonb, null),
      ('uncertain-forward', 'mixed', ${JSON.stringify({ ...snapshot, actions: [label, archive, forward, { kind: "stop-processing" }] })}::text::jsonb, 'original-revision', ${JSON.stringify(
        [
          { kind: "set-labels", status: "applied" },
          { kind: "move", status: "applied" },
        ]
      )}::text::jsonb, null),
      ('safe-forward', 'mixed', ${JSON.stringify({ ...snapshot, actions: [forward, archive, read] })}::text::jsonb, 'original-revision', ${JSON.stringify([])}::text::jsonb, null)`;

    await tx.unsafe(migration);
    await tx.unsafe(constraintsMigration);

    const rules = await tx<
      {
        actions: unknown[];
        disabledReason: string | null;
        enabled: boolean;
        id: string;
      }[]
    >`SELECT * FROM "managedMailRule" ORDER BY id`;
    const active = rules.filter((rule) => rule.enabled);
    assert.equal(active.length, 2);
    for (const rule of active) {
      assert.ok(rule.actions.length > 0);
    }
    assert.deepEqual(rules.find((rule) => rule.id === "mixed")?.actions, [
      label,
      read,
    ]);
    assert.equal(
      rules.find((rule) => rule.id === "only-archive")?.enabled,
      false
    );
    assert.equal(
      rules.find((rule) => rule.id === "disabled")?.disabledReason,
      "Owner disabled"
    );

    const jobs = await tx<
      {
        cancelledAt: Date | string | null;
        definition: { actions: unknown[]; revision: string } | null;
        id: string;
        leaseId: string | null;
        status: string;
      }[]
    >`SELECT * FROM "managedMailRuleBackfill"`;
    for (const id of ["archive-job", "inherited-job"]) {
      const job = jobs.find((row) => row.id === id);
      assert.ok(job);
      assert.equal(job.status, "cancelled");
      assert.notEqual(job.cancelledAt, null);
      assert.equal(job.leaseId, null);
    }
    const continued = jobs.find((row) => row.id === "mixed-job");
    assert.ok(continued?.definition);
    assert.equal(continued.status, "running");
    assert.equal(continued.definition.revision, snapshot.revision);
    assert.deepEqual(continued.definition.actions, [label, read]);
    assert.equal(
      jobs.find((row) => row.id === "unrelated-job")?.status,
      "pending"
    );

    const runs = await tx<
      {
        actionResults: { kind: string }[];
        completedAt: Date | string | null;
        definition: { actions: unknown[] };
        error: string | null;
        id: string;
        revision: string;
      }[]
    >`SELECT * FROM "managedMailRuleRun"`;
    const resumed = runs.find((row) => row.id === "resume");
    assert.ok(resumed);
    assert.equal(resumed.completedAt, null);
    assert.equal(resumed.revision, snapshot.revision);
    assert.deepEqual(
      resumed.actionResults.map((result) => result.kind),
      ["set-labels"]
    );
    assert.deepEqual(
      resumed.definition.actions.slice(resumed.actionResults.length),
      [read]
    );
    const history = runs.find((row) => row.id === "history");
    assert.ok(history);
    assert.deepEqual(history.definition.actions, [label, read]);
    assert.deepEqual(
      history.actionResults.map((result) => result.kind),
      ["set-labels", "set-read"]
    );
    const unsafe = runs.find((row) => row.id === "uncertain-forward");
    assert.ok(unsafe);
    assert.notEqual(unsafe.completedAt, null);
    assert.ok(unsafe.error);
    assert.deepEqual(unsafe.definition.actions, [label]);
    const safe = runs.find((row) => row.id === "safe-forward");
    assert.ok(safe);
    assert.equal(safe.completedAt, null);
    assert.equal(safe.revision, snapshot.revision);
    assert.deepEqual(safe.definition.actions, [forward, read]);
    const retired = runs.find((row) => row.id === "only-archive-run");
    assert.ok(retired);
    assert.notEqual(retired.completedAt, null);
    assert.deepEqual(retired.definition.actions, []);

    await assert.rejects(
      tx.savepoint(async (savepoint) => {
        await savepoint`INSERT INTO "managedMailRule" (id, actions, enabled) VALUES ('stale-rule', ${JSON.stringify([archive])}::text::jsonb, true)`;
      }),
      { code: "23514" }
    );
    await assert.rejects(
      tx.savepoint(async (savepoint) => {
        await savepoint`INSERT INTO "managedMailRuleBackfill" (id, "ruleId", definition, status) VALUES ('stale-job', 'mixed', ${JSON.stringify(mixed)}::text::jsonb, 'pending')`;
      }),
      { code: "23514" }
    );
    await assert.rejects(
      tx.savepoint(async (savepoint) => {
        await savepoint`INSERT INTO "managedMailRuleRun" (id, "ruleId", definition, revision, "actionResults") VALUES ('stale-run', 'mixed', ${JSON.stringify(mixed)}::text::jsonb, 'old', ${JSON.stringify([])}::text::jsonb)`;
      }),
      { code: "23514" }
    );
    await tx.unsafe(migration);
    assert.deepEqual(await tx`SELECT * FROM "managedMailRuleRun"`, runs);
  });
};
