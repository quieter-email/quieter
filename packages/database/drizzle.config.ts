import { serverEnv } from "@quieter/env/server";
import { defineConfig } from "drizzle-kit";

const databaseUrl = serverEnv.DATABASE_URL;

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  ...(databaseUrl ? { dbCredentials: { url: databaseUrl } } : {}),
  strict: true,
  verbose: true,
});
