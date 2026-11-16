import { randomBytes } from "node:crypto";

import { defineConfig } from "vite-plus";

const databaseUrl = process.env.DATABASE_URL;
const fixtureRun = process.env.QUIETER_OUTLOOK_NATIVE_RUN;
if (!databaseUrl || !fixtureRun || !/^[a-f0-9]{12}$/u.test(fixtureRun)) {
  throw new Error("Use the reviewed lane I native214 runner.");
}
const target = new URL(databaseUrl);
if (
  !["postgres:", "postgresql:"].includes(target.protocol) ||
  target.hostname !== "127.0.0.1" ||
  !target.port ||
  ["5432", "6432"].includes(target.port) ||
  target.username !== "outlook_fixture" ||
  !target.password ||
  target.pathname !== `/quieter_outlook_native_214_${fixtureRun}` ||
  target.search ||
  target.hash ||
  process.env.QUIETER_DEPLOYMENT_ENV !== "local" ||
  Object.keys(process.env).some((name) => name.startsWith("SST_RESOURCE_"))
) {
  throw new Error(
    "Native Outlook proof requires its dedicated loopback fixture."
  );
}

export default defineConfig({
  resolve: { conditions: ["development"] },
  test: {
    env: {
      BETTER_AUTH_URL: "http://127.0.0.1:19999",
      DATABASE_URL: databaseUrl,
      OUTLOOK_MAIL_CLIENT_ID: "native214-synthetic-client",
      OUTLOOK_MAIL_CLIENT_SECRET: randomBytes(32).toString("base64url"),
      OUTLOOK_MAIL_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
      QUIETER_DEPLOYMENT_ENV: "local",
    },
    exclude: ["**/node_modules/**"],
    fileParallelism: false,
    globalSetup: ["packages/orpc/tests/outlook-native-migrations.ts"],
    hookTimeout: 15_000,
    include: [
      "packages/orpc/tests/outlook-native.fixture.ts",
      "packages/orpc/tests/outlook-native-callback.fixture.ts",
    ],
    maxWorkers: 1,
    setupFiles: [],
    testTimeout: 15_000,
  },
});
