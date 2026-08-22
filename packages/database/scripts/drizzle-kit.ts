import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { serverEnv } from "@quieter/env/server";

export type {
  CheckOptions,
  GenerateOptions,
  PushOptions,
} from "drizzle-kit/cli";
export { check, generate, push } from "drizzle-kit/cli";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));

export const kitOptions = {
  dialect: "postgresql" as const,
  out: "./drizzle",
  schema: "./src/schema.ts",
};

export const kitPushOptions = () => {
  const databaseUrl = serverEnv.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("DATABASE_URL is required");
  }

  return {
    ...kitOptions,
    force: process.argv.includes("--force"),
    url: databaseUrl,
  };
};

export const exitOnKitError = (response: {
  status: string;
  error?: { code?: string; message?: string };
}) => {
  if (response.status !== "error") {
    return;
  }

  process.stderr.write(
    response.error?.message ??
      `drizzle-kit failed (${response.error?.code ?? "unknown"})\n`
  );
  throw new Error("drizzle-kit failed.");
};

export const runKitMigrate = (
  configPath = path.join(packageDirectory, "drizzle.config.ts")
) => {
  const kitBinPath = path.join(
    packageDirectory,
    "node_modules",
    "drizzle-kit",
    "bin.cjs"
  );
  if (!existsSync(kitBinPath)) {
    throw new Error("drizzle-kit is not installed in packages/database.");
  }

  const migrationResult = spawnSync(
    process.execPath,
    [kitBinPath, "migrate", `--config=${configPath}`],
    {
      cwd: packageDirectory,
      env: process.env,
      stdio: "inherit",
    }
  );

  if (migrationResult.status !== 0 || migrationResult.error !== undefined) {
    throw new Error("Drizzle migration command failed");
  }
};
