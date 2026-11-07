import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs, promisify } from "node:util";

import { z } from "zod";

const { values } = parseArgs({
  options: {
    case: { type: "string" },
    "max-key-limit": { default: "5", type: "string" },
    output: { type: "string" },
    semantic: { default: false, type: "boolean" },
  },
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
  if (values.semantic) {
    const { serverEnv } = await import("@quieter/env/server");
    if (
      serverEnv.QUIETER_DEPLOYMENT_ENV !== "local" ||
      !serverEnv.OPENROUTER_API_KEY
    ) {
      throw new Error(
        "Semantic evaluation requires a capped local development key."
      );
    }
    const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${serverEnv.OPENROUTER_API_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
    const maximumKeyLimit = z.coerce
      .number()
      .positive()
      .max(50)
      .parse(values["max-key-limit"]);
    z.object({
      data: z.object({
        limit: z.number().positive().max(maximumKeyLimit),
        limit_remaining: z.number().min(0.01),
      }),
    }).parse(await response.json());
    if (!response.ok) {
      throw new Error("Development key verification failed.");
    }
  }
  if (values.case !== undefined) {
    const { memoryRecallScenarios } =
      await import("../packages/orpc/evals/memory-recall-scenarios.ts");
    if (
      !memoryRecallScenarios.some((scenario) => scenario.id === values.case)
    ) {
      throw new Error("Choose an existing synthetic evaluation case.");
    }
  }
  const resultPath = path.join(temporary, "results.json");
  let executionFailed = false;
  try {
    // oxlint-disable-next-line typescript/strict-void-return -- Node execFile provides the callback signature consumed by promisify.
    await promisify(execFile)(
      "vp",
      [
        "test",
        "run",
        "packages/orpc/tests/memory-recall.eval.test.ts",
        "--maxWorkers=1",
      ],
      {
        env: {
          ...process.env,
          MEMORY_EVAL_REPORT: resultPath,
          MEMORY_EVAL_SEMANTIC: String(values.semantic),
          ...(values.case ? { MEMORY_EVAL_CASE: values.case } : {}),
        },
        maxBuffer: 1_000_000,
      }
    );
  } catch {
    executionFailed = true;
    process.exitCode = 1;
  }
  const result = z
    .looseObject({ status: z.string() })
    .parse(JSON.parse(await readFile(resultPath, "utf-8")));
  report = JSON.stringify(
    { ...result, status: executionFailed ? "failed" : result.status },
    null,
    2
  );
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
