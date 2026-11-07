import { readFile, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";

import { z } from "zod";

import { runSupermemoryComparison } from "../packages/orpc/evals/supermemory-comparison.ts";

const { values } = parseArgs({
  options: {
    "api-key-file": { type: "string" },
    "base-url": { type: "string" },
    "embedding-model": { type: "string" },
    "extraction-model": { type: "string" },
    output: { type: "string" },
    "quieter-report": { type: "string" },
    "resume-run-id": { type: "string" },
    scenario: { multiple: true, type: "string" },
    "service-version": { type: "string" },
    "task-type": { default: "superrag", type: "string" },
  },
});
let report;
try {
  const keyFile = values["api-key-file"];
  const baseUrl = values["base-url"];
  const embeddingModel = values["embedding-model"];
  const extractionModel = values["extraction-model"];
  const serviceVersion = values["service-version"];
  if (
    !keyFile ||
    !baseUrl ||
    !embeddingModel ||
    !extractionModel ||
    !serviceVersion
  ) {
    throw new Error(
      "Supply a loopback URL, private API key file, and explicit service/extraction/embedding versions."
    );
  }
  const key = await readFile(keyFile, "utf-8");
  const baselineFile = values["quieter-report"];
  const baselineText = baselineFile
    ? await readFile(baselineFile, "utf-8")
    : undefined;
  const quieterReport: unknown = baselineText
    ? JSON.parse(baselineText)
    : undefined;
  report = await runSupermemoryComparison({
    apiKey: key.trim(),
    baseUrl,
    embeddingModel,
    extractionModel,
    pause: setTimeout,
    quieterReport,
    resumeRunId: values["resume-run-id"],
    scenarioIds: values.scenario ?? [],
    serviceVersion,
    taskType: z.enum(["memory", "superrag"]).parse(values["task-type"]),
  });
} catch {
  report = {
    reason:
      "Comparison could not complete. Verify explicit local service options, API access, processing readiness, and provider budget.",
    status: "blocked",
  };
  process.exitCode = 1;
}
const json = `${JSON.stringify(report, null, 2)}\n`;
if (values.output) {
  await writeFile(values.output, json);
}
process.stdout.write(json);
