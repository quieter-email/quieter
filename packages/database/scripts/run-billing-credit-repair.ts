import { execFileSync } from "node:child_process";

import postgres from "postgres";

import {
  assertMigrationExecutionAllowed,
  getMigrationDatabaseUrl,
} from "./database-url.ts";
import { repairBillingCreditOverage } from "./repair-billing-credit-overage.ts";

const databaseUrl = getMigrationDatabaseUrl();
assertMigrationExecutionAllowed(databaseUrl);
if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.GITHUB_REF !== "refs/heads/main"
) {
  throw new Error(
    "Run this repair through the protected billing maintenance workflow."
  );
}
const sql = postgres(databaseUrl, { max: 1 });
const snapshotKey = `billing-repairs/${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}.json`;
try {
  const result = await repairBillingCreditOverage(sql, (rows) => {
    execFileSync(
      "aws",
      [
        "s3",
        "cp",
        "-",
        `s3://sst-state-cwuvuztxrtsh/${snapshotKey}`,
        "--region",
        "eu-central-1",
        "--sse",
        "AES256",
        "--only-show-errors",
      ],
      {
        input: JSON.stringify({ revision: process.env.GITHUB_SHA, rows }),
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 30_000,
      }
    );
  });
  process.stdout.write(
    `${JSON.stringify({
      ...result,
      snapshotKey: result.repaired > 0 ? snapshotKey : null,
    })}\n`
  );
} finally {
  await sql.end();
}
