import { describe, expect, test } from "bun:test";
import {
  assertLocalDatabaseUrl,
  assertLocalDevelopmentDatabaseUrls,
  assertMigrationExecutionAllowed,
} from "./database-url";
import { assertMigrationSqlIsDeploySafe } from "./migration-safety";

describe("destructive database target guard", () => {
  test("accepts the dedicated local migration test database", () => {
    expect(() =>
      assertLocalDatabaseUrl(
        "postgresql://postgres:postgres@localhost:5432/quieter_migration_test",
        "quieter_migration_test",
      ),
    ).not.toThrow();
  });

  test("accepts an IPv6 loopback database", () => {
    expect(() =>
      assertLocalDatabaseUrl(
        "postgresql://postgres:postgres@[::1]:5432/quieter_migration_test",
        "quieter_migration_test",
      ),
    ).not.toThrow();
  });

  test("rejects remote databases", () => {
    expect(() =>
      assertLocalDatabaseUrl(
        "postgresql://user:password@production.example.com/quieter_migration_test",
        "quieter_migration_test",
      ),
    ).toThrow("loopback");
  });

  test("rejects a non-test database on localhost", () => {
    expect(() =>
      assertLocalDatabaseUrl(
        "postgresql://postgres:postgres@localhost:5432/quieter",
        "quieter_migration_test",
      ),
    ).toThrow("quieter_migration_test");
  });
});

describe("local development database boundary", () => {
  test("allows local application and migration databases", () => {
    expect(() =>
      assertLocalDevelopmentDatabaseUrls({
        DATABASE_MIGRATION_URL: "postgresql://postgres:postgres@localhost:5432/quieter",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/quieter",
      }),
    ).not.toThrow();
  });

  test.each(["DATABASE_URL", "DATABASE_MIGRATION_URL"] as const)("rejects a remote %s", (name) => {
    expect(() =>
      assertLocalDevelopmentDatabaseUrls({
        [name]: "postgresql://user:password@production.example.com/quieter",
      }),
    ).toThrow(`${name} must target local PostgreSQL`);
  });
});

describe("migration execution boundary", () => {
  const remoteDatabaseUrl = "postgresql://user:password@production.example.com/quieter";
  const approvedProductionEnvironment = {
    CI: "true",
    GITHUB_ACTIONS: "true",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REF_PROTECTED: "true",
    GITHUB_REPOSITORY: "quieter-email/quieter",
    QUIETER_ALLOW_REMOTE_MIGRATIONS: "production",
  };

  test("allows local migrations without CI", () => {
    expect(() =>
      assertMigrationExecutionAllowed("postgresql://postgres:postgres@localhost:5432/quieter", {}),
    ).not.toThrow();
  });

  test("allows IPv6 loopback migrations without CI", () => {
    expect(() =>
      assertMigrationExecutionAllowed("postgresql://postgres:postgres@[::1]:5432/quieter", {}),
    ).not.toThrow();
  });

  test("allows remote migrations only in the approved production job", () => {
    expect(() =>
      assertMigrationExecutionAllowed(remoteDatabaseUrl, approvedProductionEnvironment),
    ).not.toThrow();
  });

  test.each([
    ["developer machine", {}],
    ["non-GitHub CI", { ...approvedProductionEnvironment, GITHUB_ACTIONS: undefined }],
    ["unprotected ref", { ...approvedProductionEnvironment, GITHUB_REF_PROTECTED: "false" }],
    ["non-main branch", { ...approvedProductionEnvironment, GITHUB_REF: "refs/heads/feature" }],
    [
      "different repository",
      { ...approvedProductionEnvironment, GITHUB_REPOSITORY: "fork/quieter" },
    ],
    [
      "missing production marker",
      { ...approvedProductionEnvironment, QUIETER_ALLOW_REMOTE_MIGRATIONS: undefined },
    ],
  ])("rejects remote migrations from %s", (_, environment) => {
    expect(() => assertMigrationExecutionAllowed(remoteDatabaseUrl, environment)).toThrow(
      "approved GitHub Actions deployment jobs",
    );
  });
});

describe("automated migration safety", () => {
  test("accepts additive migrations", () => {
    expect(() =>
      assertMigrationSqlIsDeploySafe('ALTER TABLE "user" ADD COLUMN "locale" text;', "add_locale"),
    ).not.toThrow();
  });

  test.each([
    'DROP TABLE "user";',
    "DROP SCHEMA public CASCADE;",
    'TRUNCATE TABLE "user";',
    'DELETE FROM "user";',
    'ALTER TABLE "user" DROP COLUMN "email";',
    'ALTER TABLE "user" ALTER COLUMN "id" TYPE uuid;',
  ])("rejects destructive SQL: %s", (sql) => {
    expect(() => assertMigrationSqlIsDeploySafe(sql, "unsafe")).toThrow("destructive SQL");
  });
});
