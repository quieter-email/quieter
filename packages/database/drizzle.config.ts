import { serverEnv } from "@quieter/env/server";
import { defineConfig } from "drizzle-kit";

const databaseUrl = serverEnv.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./src/schema.ts",
  ...(databaseUrl !== null && databaseUrl !== undefined && databaseUrl !== ""
    ? { dbCredentials: { url: databaseUrl } }
    : {}),
  strict: true,
  verbose: true,
});
