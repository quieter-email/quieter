import postgres from "postgres";

import {
  assertMigrationExecutionAllowed,
  getMigrationDatabaseUrl,
} from "./database-url.ts";
import { releasePersonalActionCutover } from "./personal-action-cutover.ts";

export const releaseRecoveredPersonalActionCutover = async (
  input: Parameters<typeof releasePersonalActionCutover>[1] & {
    expectedWorkflowIdentity: string;
  }
) => {
  const databaseUrl = getMigrationDatabaseUrl();
  if (assertMigrationExecutionAllowed(databaseUrl) !== "production") {
    throw new Error(
      "Cutover recovery requires the protected production workflow"
    );
  }
  const sql = postgres(databaseUrl, {
    max: 1,
    onnotice: (notice) => {
      process.stderr.write(`${notice.message}\n`);
    },
  });
  try {
    return await releasePersonalActionCutover(sql, input);
  } finally {
    await sql.end();
  }
};
