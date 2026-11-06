import { parseArgs } from "node:util";

import postgres from "postgres";

import {
  assertMigrationExecutionAllowed,
  getMigrationDatabaseUrl,
} from "./database-url.ts";
import {
  assertPersonalActionCutover,
  getPersonalActionCutoverStatus,
  preparePersonalActionCutover,
  releasePersonalActionCutover,
} from "./personal-action-cutover.ts";

const {
  positionals: [command],
  values,
} = parseArgs({
  allowPositionals: true,
  options: {
    "build-id": { type: "string" },
    "expected-previous-build-id": { type: "string" },
    "verified-build-id": { type: "string" },
  },
});
if (!["prepare", "assert", "release", "status"].includes(command ?? "")) {
  throw new Error("Expected prepare, assert, release, or status");
}
const databaseUrl = getMigrationDatabaseUrl();
const target = assertMigrationExecutionAllowed(databaseUrl);
const buildId = values["build-id"] ?? process.env.GITHUB_SHA;
const workflowIdentity = `${process.env.GITHUB_RUN_ID ?? "local"}/${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`;
if (
  command !== "status" &&
  (!buildId || !/^[a-zA-Z0-9_-]{1,160}$/u.test(buildId))
) {
  throw new Error("A valid build ID is required");
}
if (
  target === "production" &&
  buildId !== process.env.GITHUB_SHA &&
  command !== "status"
) {
  throw new Error(
    "Production cutover must target the current protected workflow commit"
  );
}
const sql = postgres(databaseUrl, {
  max: 1,
  onnotice: (notice) => {
    process.stderr.write(`${notice.message}\n`);
  },
});
try {
  const status = await getPersonalActionCutoverStatus(sql);
  if (
    target === "production" &&
    (command === "release" || (command === "prepare" && status.required)) &&
    process.env.GITHUB_EVENT_NAME !== "workflow_dispatch"
  ) {
    throw new Error(
      "Action cutover prepare and release require the protected manual production workflow"
    );
  }
  if (command === "prepare" && buildId) {
    await preparePersonalActionCutover(sql, {
      buildId,
      expectedPreviousBuildId: values["expected-previous-build-id"],
      workflowIdentity,
    });
  } else if (command === "assert") {
    await assertPersonalActionCutover(sql, {
      ...(status.pending ? { buildId } : {}),
      requirePersonalTable: !status.pending,
    });
  } else if (command === "release" && buildId) {
    const verifiedDeploymentBuildId =
      values["verified-build-id"] ??
      process.env.QUIETER_ACTION_CUTOVER_VERIFIED_BUILD_ID;
    if (!verifiedDeploymentBuildId) {
      throw new Error(
        "Release requires the build ID from successful deployed-consumer verification"
      );
    }
    await releasePersonalActionCutover(sql, {
      buildId,
      verifiedDeploymentBuildId,
      workflowIdentity,
    });
  }
  process.stdout.write(
    `${JSON.stringify(await getPersonalActionCutoverStatus(sql))}\n`
  );
} finally {
  await sql.end();
}
