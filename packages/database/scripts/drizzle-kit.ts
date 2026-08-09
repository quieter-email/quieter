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

export const runKitMigrate = async (
  configPath = path.join(packageDirectory, "drizzle.config.ts")
) => {
  const migrationProcess = Bun.spawn(
    ["bunx", "drizzle-kit", "migrate", `--config=${configPath}`],
    {
      cwd: packageDirectory,
      env: globalThis.process.env,
      stderr: "inherit",
      stdout: "inherit",
    }
  );

  const exitCode = await migrationProcess.exited;
  if (exitCode !== 0) {
    throw new Error("Drizzle migration command failed");
  }
};
