import { serverEnv } from "@quieter/env/server";
import { check, generate, push } from "drizzle-kit/cli";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export { check, generate, push };
export type { CheckOptions, GenerateOptions, PushOptions } from "drizzle-kit/cli";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));

export const kitOptions = {
  dialect: "postgresql" as const,
  schema: "./src/schema.ts",
  out: "./drizzle",
};

export const kitPushOptions = () => {
  const databaseUrl = serverEnv.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  return {
    ...kitOptions,
    url: databaseUrl,
    force: process.argv.includes("--force"),
  };
};

export const exitOnKitError = (response: {
  status: string;
  error?: { code?: string; message?: string };
}) => {
  if (response.status !== "error") {
    return;
  }

  console.error(
    response.error?.message ?? `drizzle-kit failed (${response.error?.code ?? "unknown"})`,
  );
  globalThis.process.exit(1);
};

export const runKitMigrate = async (configPath = join(packageDirectory, "drizzle.config.ts")) => {
  const migrationProcess = Bun.spawn(["bunx", "drizzle-kit", "migrate", `--config=${configPath}`], {
    cwd: packageDirectory,
    env: globalThis.process.env,
    stderr: "inherit",
    stdout: "inherit",
  });

  const exitCode = await migrationProcess.exited;
  if (exitCode !== 0) {
    throw new Error("Drizzle migration command failed");
  }
};
