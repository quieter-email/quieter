import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type postgres from "postgres";

export const PERSONAL_ACTION_PROTOCOL = "personal-actions-v1";
export const PERSONAL_ACTION_MIGRATIONS = [
  "20261104164249_stale_maggott",
  "20261104164750_ordinary_payback",
  "20261104170538_invalidate_pre_membership_authority",
] as const;

type CutoverState = {
  id: string;
  phase: "fenced" | "ready";
  buildId: string;
  workflowIdentity: string;
  preparedBy: string;
  preparedAt: Date;
  releasedAt: Date | null;
};
type CutoverBuild = { buildId: string; workflowIdentity: string };
type CutoverConnection = postgres.Sql | postgres.TransactionSql;

const guardBody = `
DECLARE
  cutover_phase text;
  maintenance_user text;
BEGIN
  SELECT phase, "preparedBy" INTO cutover_phase, maintenance_user
    FROM drizzle.personal_action_cutover WHERE id = 'personal-actions-v1' FOR SHARE;
  IF cutover_phase IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', CONSTRAINT = 'quieter_action_cutover',
      MESSAGE = 'Action update protection is missing. Please try again shortly.';
  END IF;
  IF current_setting('quieter.action_cutover', true) = 'maintenance'
    AND session_user = maintenance_user THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF pg_trigger_depth() > 1 AND TG_OP IN ('DELETE', 'UPDATE') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'mailboxAgentSetting' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', CONSTRAINT = 'quieter_action_cutover',
      MESSAGE = 'This version can no longer change Actions. Reload and try again.';
  END IF;
  IF TG_TABLE_NAME = 'mailboxAgentRun' AND TG_OP = 'UPDATE' THEN
    IF NEW.status <> 'running' OR
      (OLD.status = 'running' AND NEW."leaseToken" IS NOT DISTINCT FROM OLD."leaseToken"
        AND NEW."leaseExpiresAt" IS NOT DISTINCT FROM OLD."leaseExpiresAt") THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'mailbox' THEN
    IF NEW."accessMode" IS NOT DISTINCT FROM OLD."accessMode"
      AND NEW."managedOwnerUserId" IS NOT DISTINCT FROM OLD."managedOwnerUserId"
      AND NEW."ownerUserId" IS NOT DISTINCT FROM OLD."ownerUserId"
      AND NEW."organizationId" IS NOT DISTINCT FROM OLD."organizationId"
      AND NEW.provider IS NOT DISTINCT FROM OLD.provider
      AND NEW."divisionId" IS NOT DISTINCT FROM OLD."divisionId" THEN RETURN NEW; END IF;
  END IF;
  IF cutover_phase <> 'ready' OR
    current_setting('quieter.action_protocol', true) IS DISTINCT FROM 'personal-actions-v1' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', CONSTRAINT = 'quieter_action_cutover',
      MESSAGE = 'Actions are temporarily unavailable while an update is being completed. Please try again shortly.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
`;

const guardedTables = [
  {
    events: "INSERT OR UPDATE OR DELETE",
    table: "mailboxAgentSetting",
    type: 31,
  },
  { events: "INSERT OR UPDATE", table: "mailboxAgentRun", type: 23 },
  { events: "INSERT", table: "mailboxAgentEffect", type: 7 },
  { events: "INSERT OR UPDATE OR DELETE", table: "mailboxGrant", type: 31 },
  {
    events: "INSERT OR UPDATE OR DELETE",
    table: "mailboxDivisionGrant",
    type: 31,
  },
  { events: "UPDATE", table: "mailbox", type: 19 },
  {
    events: "INSERT OR UPDATE OR DELETE",
    table: "mailboxPersonalAgentSetting",
    type: 31,
  },
];

export const getPersonalActionCutoverStatus = async (
  sql: CutoverConnection
) => {
  const [catalog] = await sql<{ exists: boolean }[]>`
    SELECT to_regclass('drizzle.personal_action_cutover') IS NOT NULL AS exists
  `;
  if (!catalog?.exists) {
    return { pending: false, required: true, state: null };
  }
  const [state] = await sql<CutoverState[]>`
    SELECT * FROM drizzle.personal_action_cutover WHERE id = ${PERSONAL_ACTION_PROTOCOL}
  `;
  return {
    pending: state?.phase === "fenced",
    required: state?.phase !== "ready",
    state: state ?? null,
  };
};

export const installPersonalActionGuards = async (sql: CutoverConnection) => {
  await sql.unsafe(`CREATE OR REPLACE FUNCTION drizzle.guard_personal_actions()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, drizzle, public AS $guard$${guardBody}$guard$`);
  for (const { table, events } of guardedTables) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Guards must be installed on the migration connection in order.
    const [catalog] = await sql<{ exists: boolean }[]>`
      SELECT to_regclass(${`public."${table}"`}) IS NOT NULL AS exists
    `;
    if (!catalog?.exists) {
      if (table === "mailboxPersonalAgentSetting") {
        continue;
      }
      throw new Error(`Action cutover requires public.${table}`);
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each table needs its own trigger.
    await sql.unsafe(`CREATE OR REPLACE TRIGGER quieter_action_cutover
      BEFORE ${events} ON public."${table}" FOR EACH ROW
      EXECUTE FUNCTION drizzle.guard_personal_actions()`);
  }
};

export const assertPersonalActionCutover = async (
  sql: CutoverConnection,
  input: {
    buildId?: string;
    phase?: "fenced" | "ready";
    requirePersonalTable?: boolean;
  } = {}
) => {
  const { state } = await getPersonalActionCutoverStatus(sql);
  if (
    state === null ||
    (input.phase !== undefined && state.phase !== input.phase) ||
    (input.buildId !== undefined && state.buildId !== input.buildId)
  ) {
    throw new Error(
      "Personal Action cutover is pending or targets another build. Run the protected cutover preparation before migrating or releasing."
    );
  }
  const [functionRow] = await sql<
    {
      source: string;
      secure: boolean;
      configuration: string[];
      owner: string;
    }[]
  >`
    SELECT prosrc AS source, prosecdef AS secure, proconfig AS configuration, pg_get_userbyid(proowner) AS owner
    FROM pg_proc WHERE oid = to_regprocedure('drizzle.guard_personal_actions()')
  `;
  if (
    functionRow?.source !== guardBody ||
    functionRow.owner !== state.preparedBy ||
    !functionRow.secure ||
    !functionRow.configuration.includes(
      "search_path=pg_catalog, drizzle, public"
    )
  ) {
    throw new Error(
      "Personal Action database guard definition is missing or changed"
    );
  }
  const triggers = await sql<
    {
      table: string;
      type: number;
      enabled: string;
      function: string;
      unconditional: boolean;
    }[]
  >`
    SELECT relation.relname AS table, trigger.tgtype AS type, trigger.tgenabled AS enabled,
      trigger.tgfoid::regproc::text AS function,
      (trigger.tgqual IS NULL AND trigger.tgattr::text = '' AND trigger.tgnargs = 0 AND NOT trigger.tgisinternal) AS unconditional
    FROM pg_trigger AS trigger JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE trigger.tgname = 'quieter_action_cutover' AND namespace.nspname = 'public'
  `;
  const [personalTable] = await sql<{ exists: boolean }[]>`
    SELECT to_regclass('public."mailboxPersonalAgentSetting"') IS NOT NULL AS exists
  `;
  for (const expected of guardedTables) {
    if (
      expected.table === "mailboxPersonalAgentSetting" &&
      input.requirePersonalTable !== true &&
      !personalTable?.exists
    ) {
      continue;
    }
    if (
      !triggers.some(
        (trigger) =>
          trigger.table === expected.table &&
          trigger.type === expected.type &&
          trigger.enabled === "O" &&
          trigger.unconditional &&
          trigger.function === "drizzle.guard_personal_actions"
      )
    ) {
      throw new Error(
        `Personal Action guard is missing or changed on ${expected.table}`
      );
    }
  }
  return state;
};

export const preparePersonalActionCutover = async (
  sql: postgres.Sql,
  input: CutoverBuild & { expectedPreviousBuildId?: string }
) =>
  await sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext('quieter-forward-migrations'))`;
    await transaction`SET LOCAL lock_timeout = '5s'`;
    const { state } = await getPersonalActionCutoverStatus(transaction);
    if (state !== null) {
      await assertPersonalActionCutover(transaction);
      if (state.phase === "ready") {
        return state;
      }
      if (state.buildId !== input.buildId) {
        if (input.expectedPreviousBuildId !== state.buildId) {
          throw new Error(
            "A different build owns the Action fence. Explicitly name its build ID to resume with this build."
          );
        }
        await transaction`UPDATE drizzle.personal_action_cutover
        SET "buildId" = ${input.buildId}, "workflowIdentity" = ${input.workflowIdentity}
        WHERE id = ${PERSONAL_ACTION_PROTOCOL}`;
      }
      const resumed = await getPersonalActionCutoverStatus(transaction);
      return resumed.state;
    }
    await transaction`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await transaction`CREATE TABLE drizzle.personal_action_cutover (
    id text PRIMARY KEY CHECK (id = 'personal-actions-v1'),
    phase text NOT NULL CHECK (phase IN ('fenced', 'ready')),
    "buildId" text NOT NULL, "workflowIdentity" text NOT NULL,
    "preparedBy" text NOT NULL, "preparedAt" timestamptz NOT NULL DEFAULT now(),
    "releasedAt" timestamptz
  )`;
    await transaction`REVOKE ALL ON drizzle.personal_action_cutover FROM PUBLIC`;
    await transaction`LOCK TABLE public.mailbox, public."mailboxAgentSetting", public."mailboxAgentRun",
      public."mailboxAgentEffect", public."mailboxGrant", public."mailboxDivisionGrant"
    IN ACCESS EXCLUSIVE MODE`;
    await transaction`INSERT INTO drizzle.personal_action_cutover (id, phase, "buildId", "workflowIdentity", "preparedBy")
    VALUES (${PERSONAL_ACTION_PROTOCOL}, 'fenced', ${input.buildId}, ${input.workflowIdentity}, session_user)`;
    await installPersonalActionGuards(transaction);
    await transaction`SELECT set_config('quieter.action_cutover', 'maintenance', true)`;
    await transaction`UPDATE public."mailboxAgentEffect" SET status = 'uncertain', "updatedAt" = now()
    WHERE status = 'pending'`;
    await transaction`UPDATE public."mailboxAgentRun" AS run SET
    status = CASE WHEN EXISTS (SELECT 1 FROM public."mailboxAgentEffect" AS effect WHERE effect."runId" = run.id)
      THEN 'needs_attention' ELSE 'queued' END,
    attempts = CASE WHEN EXISTS (SELECT 1 FROM public."mailboxAgentEffect" AS effect WHERE effect."runId" = run.id)
      THEN run.attempts ELSE greatest(run.attempts - 1, 0) END,
    "leaseToken" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = now(),
    "finishedAt" = CASE WHEN EXISTS (SELECT 1 FROM public."mailboxAgentEffect" AS effect WHERE effect."runId" = run.id)
      THEN now() ELSE NULL END
    WHERE run.status = 'running'`;
    await assertPersonalActionCutover(transaction);
    const prepared = await getPersonalActionCutoverStatus(transaction);
    return prepared.state;
  });

export const releasePersonalActionCutover = async (
  sql: postgres.Sql,
  input: CutoverBuild & { verifiedDeploymentBuildId: string }
) =>
  await sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext('quieter-forward-migrations'))`;
    if (input.verifiedDeploymentBuildId !== input.buildId) {
      throw new Error(
        "The verified deployment does not match the Action cutover build"
      );
    }
    const state = await assertPersonalActionCutover(transaction, {
      buildId: input.buildId,
      requirePersonalTable: true,
    });
    const ledger = await transaction<
      { name: string; hash: string }[]
    >`SELECT name, hash FROM drizzle.__drizzle_migrations`;
    if (
      !PERSONAL_ACTION_MIGRATIONS.every((name) =>
        ledger.some(
          (row) =>
            row.name === name &&
            row.hash ===
              createHash("sha256")
                .update(
                  readFileSync(
                    new URL(`../drizzle/${name}/migration.sql`, import.meta.url)
                  )
                )
                .digest("hex")
        )
      )
    ) {
      throw new Error("Personal Action migrations are incomplete");
    }
    if (state.phase === "fenced") {
      await transaction`UPDATE drizzle.personal_action_cutover SET phase = 'ready', "releasedAt" = now(),
      "workflowIdentity" = ${input.workflowIdentity} WHERE id = ${PERSONAL_ACTION_PROTOCOL}`;
    }
    const released = await getPersonalActionCutoverStatus(transaction);
    return released.state;
  });
