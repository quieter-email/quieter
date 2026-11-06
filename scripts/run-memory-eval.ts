import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs, promisify } from "node:util";

const { values } = parseArgs({
  options: { output: { type: "string" } },
});
const temporary = await mkdtemp(path.join(tmpdir(), "quieter-memory-eval-"));
let report: string;
try {
  const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "Set MIGRATION_TEST_DATABASE_URL to disposable loopback quieter_migration_test PostgreSQL."
    );
  }
  const url = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/quieter_migration_test" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Evaluation accepts only disposable loopback quieter_migration_test PostgreSQL without URL options."
    );
  }
  const resultPath = path.join(temporary, "results.json");
  try {
    // oxlint-disable-next-line typescript/strict-void-return -- Node execFile provides the callback signature consumed by promisify.
    await promisify(execFile)(
      "vp",
      ["test", "run", "packages/orpc/tests/memory-recall.eval.test.ts"],
      {
        env: { ...process.env, MEMORY_EVAL_REPORT: resultPath },
        maxBuffer: 1_000_000,
      }
    );
  } catch {
    process.exitCode = 1;
  }
  report = await readFile(resultPath, "utf-8");
} catch {
  report = JSON.stringify(
    {
      layer: "canonical-sql-recall",
      reason:
        "Evaluation could not complete. Configure and migrate disposable loopback quieter_migration_test PostgreSQL, then run the dedicated evaluation test for diagnostics.",
      status: "blocked",
    },
    null,
    2
  );
  process.exitCode = 1;
} finally {
  await rm(temporary, { force: true, recursive: true });
}
if (values.output) {
  await writeFile(values.output, `${report}\n`);
}
process.stdout.write(`${report}\n`);
