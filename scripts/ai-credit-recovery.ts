import { configureServerEnv, serverEnv } from "@quieter/env/server";
import { Resource } from "sst";
import { z } from "zod";

const [request, execution] = process.argv.slice(2);
try {
  if (execution === "--local") {
    const url = new URL(serverEnv.DATABASE_URL ?? "");
    if (
      serverEnv.QUIETER_DEPLOYMENT_ENV !== "local" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    ) {
      throw new Error(
        "Local recovery requires a loopback development database."
      );
    }
  } else if (
    execution !== undefined &&
    /^github-run:[0-9]+:[a-zA-Z0-9-]+$/u.test(execution) &&
    Resource.App.stage === "production"
  ) {
    configureServerEnv({
      DATABASE_URL: z
        .object({ value: z.string().min(1) })
        .parse(Reflect.get(Resource, "DatabaseUrl")).value,
      QUIETER_DEPLOYMENT_ENV: "production",
    });
  } else {
    throw new Error(
      "Use the protected production workflow or explicit local execution."
    );
  }
  const { runAiCreditRecovery } =
    await import("../packages/billing/src/ai-credit-recovery.ts");
  const { withRequestDatabaseClient } =
    await import("../packages/database/src/client.ts");
  const raw: unknown = JSON.parse(request ?? "");
  if (
    execution !== "--local" &&
    typeof raw === "object" &&
    raw !== null &&
    "mode" in raw &&
    raw.mode !== "inspect"
  ) {
    Reflect.set(raw, "operator", execution);
  }
  await withRequestDatabaseClient(async (client) => {
    try {
      const result = await runAiCreditRecovery(raw);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } finally {
      await client.$client.end();
    }
  });
} catch {
  process.stderr.write(
    "AI credit recovery failed. Check the request, linked stage, evidence and current reservation snapshot. No request or database details are logged.\n"
  );
  process.exitCode = 1;
}
