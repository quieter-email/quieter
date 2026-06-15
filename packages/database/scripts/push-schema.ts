import { serverEnv } from "@quieter/env/server";
import { fileURLToPath } from "node:url";
import { assertLocalDatabaseUrl } from "./database-url";

const databaseUrl = serverEnv.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

assertLocalDatabaseUrl(databaseUrl);

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const pushProcess = Bun.spawn(["bunx", "drizzle-kit", "push", ...process.argv.slice(2)], {
  cwd: packageDirectory,
  env: globalThis.process.env,
  stderr: "inherit",
  stdout: "inherit",
});

globalThis.process.exit(await pushProcess.exited);
