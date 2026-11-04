import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { runForwardMigrations } from "./run-forward-migrations.ts";

const transport = vi.hoisted(() => {
  const appliedNames: string[] = [];
  return {
    appliedNames,
    end: vi.fn<() => Promise<null>>().mockResolvedValue(null),
    insert: vi.fn<() => void>(),
    migrate: vi.fn<() => void>(),
    query: vi
      .fn<() => Promise<{ exists: boolean }[]>>()
      .mockResolvedValue([{ exists: true }]),
    unsafe: vi.fn<() => Promise<null>>().mockResolvedValue(null),
  };
});

vi.mock<unknown>(import("postgres"), () => ({
  default: () =>
    Object.assign(transport.query, {
      end: transport.end,
      unsafe: transport.unsafe,
    }),
}));
vi.mock<unknown>(import("drizzle-orm/postgres-js"), () => ({
  drizzle: () => ({
    insert: transport.insert,
    select: () => ({
      from: () => ({
        where: () => transport.appliedNames.map((name) => ({ name })),
      }),
    }),
  }),
}));
vi.mock(import("./drizzle-kit.ts"), () => ({
  runKitMigrate: transport.migrate,
}));

const cutover = "20261104164249_stale_maggott";
const correction = "20261104170538_invalidate_pre_membership_authority";
const productionUrl = "postgresql://migrator@production.example.com/quieter";
const productionEnvironment = {
  CI: "true",
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "push",
  GITHUB_REF: "refs/heads/main",
  GITHUB_REF_PROTECTED: "true",
  GITHUB_REPOSITORY: "quieter-email/quieter",
  QUIETER_ALLOW_REMOTE_MIGRATIONS: "production",
};
describe("personal Action production cutover preflight", () => {
  let directory: string;

  beforeEach(() => {
    vi.clearAllMocks();
    transport.appliedNames.length = 0;
    transport.query.mockResolvedValue([{ exists: true }]);
    directory = mkdtempSync(path.join(tmpdir(), "quieter-cutover-test-"));
    mkdirSync(path.join(directory, cutover));
    writeFileSync(
      path.join(directory, cutover, "migration.sql"),
      "-- quieter:contract\nSELECT 1;"
    );
    mkdirSync(path.join(directory, correction));
    writeFileSync(
      path.join(directory, correction, "migration.sql"),
      "-- quieter:contract\nSELECT 1;"
    );
  });

  afterEach(() => {
    rmSync(directory, { force: true, recursive: true });
  });

  test.each([
    productionEnvironment,
    { ...productionEnvironment, GITHUB_EVENT_NAME: "workflow_dispatch" },
    {
      ...productionEnvironment,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      QUIETER_PERSONAL_ACTION_CUTOVER_ACKNOWLEDGED: "false",
    },
    {
      ...productionEnvironment,
      QUIETER_PERSONAL_ACTION_CUTOVER_ACKNOWLEDGED: "true",
    },
  ])(
    "blocks pending cutover without an acknowledged manual dispatch %#",
    async (environment) => {
      await expect(
        runForwardMigrations(
          {
            databaseUrl: productionUrl,
            migrationsDirectory: directory,
            packageDirectory: directory,
          },
          environment
        )
      ).rejects.toThrow("Personal Action cutover is pending");
      expect(transport.migrate).not.toHaveBeenCalled();
      expect(transport.unsafe).not.toHaveBeenCalled();
      expect(transport.insert).not.toHaveBeenCalled();
      expect(transport.end).toHaveBeenCalledWith();
    }
  );

  test("blocks before a pending historical non-transactional prefix can mutate the database", async () => {
    const historical = "20261101000000_pending_index";
    mkdirSync(path.join(directory, historical));
    writeFileSync(
      path.join(directory, historical, "migration.sql"),
      "-- quieter:no-transaction\nCREATE INDEX CONCURRENTLY notes_idx ON notes (id);"
    );
    transport.query.mockResolvedValue([{ exists: false }]);

    await expect(
      runForwardMigrations(
        {
          databaseUrl: productionUrl,
          migrationsDirectory: directory,
          packageDirectory: directory,
        },
        productionEnvironment
      )
    ).rejects.toThrow("Personal Action cutover is pending");
    expect(transport.migrate).not.toHaveBeenCalled();
    expect(transport.unsafe).not.toHaveBeenCalled();
    expect(transport.insert).not.toHaveBeenCalled();
  });

  test("allows pending cutover only after manual acknowledgement in the protected production job", async () => {
    await runForwardMigrations(
      {
        databaseUrl: productionUrl,
        migrationsDirectory: directory,
        packageDirectory: directory,
      },
      {
        ...productionEnvironment,
        GITHUB_EVENT_NAME: "workflow_dispatch",
        QUIETER_PERSONAL_ACTION_CUTOVER_ACKNOWLEDGED: "true",
      }
    );
    expect(transport.migrate).toHaveBeenCalledOnce();
  });

  test("allows subsequent push deployments when cutover is already applied", async () => {
    transport.appliedNames.push(cutover, correction);
    await runForwardMigrations(
      {
        databaseUrl: productionUrl,
        migrationsDirectory: directory,
        packageDirectory: directory,
      },
      productionEnvironment
    );
    expect(transport.migrate).toHaveBeenCalledOnce();
  });

  test("blocks a partially applied cutover until the authority correction is acknowledged", async () => {
    transport.appliedNames.push(cutover);
    await expect(
      runForwardMigrations(
        {
          databaseUrl: productionUrl,
          migrationsDirectory: directory,
          packageDirectory: directory,
        },
        productionEnvironment
      )
    ).rejects.toThrow("Personal Action cutover is pending");
    expect(transport.migrate).not.toHaveBeenCalled();
    expect(transport.unsafe).not.toHaveBeenCalled();
    expect(transport.insert).not.toHaveBeenCalled();
  });

  test.each([
    ["postgresql://postgres@127.0.0.1:5432/quieter", {}],
    ["postgresql://postgres@[::1]:5432/quieter", {}],
    [
      "postgresql://migrator@test.pg.psdb.cloud:5432/quieter_dev?sslmode=verify-full",
      {
        QUIETER_DEPLOYMENT_ENV: "local",
        QUIETER_LOCAL_PLANETSCALE_HOST: "test.pg.psdb.cloud",
      },
    ],
  ])(
    "allows development cutover without acknowledgement at %s",
    async (databaseUrl, environment) => {
      await runForwardMigrations(
        {
          databaseUrl,
          migrationsDirectory: directory,
          packageDirectory: directory,
        },
        environment
      );
      expect(transport.migrate).toHaveBeenCalledOnce();
    }
  );

  test("manual acknowledgement cannot bypass the protected production ref", async () => {
    await expect(
      runForwardMigrations(
        {
          databaseUrl: productionUrl,
          migrationsDirectory: directory,
          packageDirectory: directory,
        },
        {
          ...productionEnvironment,
          GITHUB_EVENT_NAME: "workflow_dispatch",
          GITHUB_REF_PROTECTED: "false",
          QUIETER_PERSONAL_ACTION_CUTOVER_ACKNOWLEDGED: "true",
        }
      )
    ).rejects.toThrow("approved GitHub Actions deployment jobs");
    expect(transport.query).not.toHaveBeenCalled();
    expect(transport.migrate).not.toHaveBeenCalled();
  });
});
