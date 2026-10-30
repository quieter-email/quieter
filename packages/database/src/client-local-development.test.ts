import { configureServerEnv } from "@quieter/env/server";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { assertDatabaseConfigured } from "./client.ts";

const resources = vi.hoisted<{ AppDatabaseV2: unknown }>(() => ({
  AppDatabaseV2: undefined,
}));
vi.mock(import("sst"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    Resource: new Proxy(actual.Resource, {
      get(target, property): unknown {
        return property === "AppDatabaseV2"
          ? resources.AppDatabaseV2
          : Reflect.get(target, property);
      },
    }),
  };
});

describe("local database consumption boundary", () => {
  beforeEach(() => {
    vi.stubGlobal("__QUIETER_LOCAL_DEVELOPMENT__", true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resources.AppDatabaseV2 = undefined;
    configureServerEnv({
      DATABASE_URL: "postgresql://postgres@127.0.0.1/quieter",
      QUIETER_DEPLOYMENT_ENV: "production",
      QUIETER_LOCAL_PLANETSCALE_HOST: undefined,
    });
  });

  test("preserves deployed database configuration outside the development runtime", () => {
    vi.unstubAllGlobals();
    configureServerEnv({
      DATABASE_URL: "postgresql://user@database.invalid/quieter",
      QUIETER_DEPLOYMENT_ENV: "production",
    });
    expect(assertDatabaseConfigured).not.toThrow();
  });

  test("guards local Node callers outside the development runtime", () => {
    vi.stubGlobal("__QUIETER_LOCAL_DEVELOPMENT__", false);
    configureServerEnv({
      DATABASE_URL: "postgresql://user@database.invalid/quieter",
      QUIETER_DEPLOYMENT_ENV: "local",
    });
    expect(assertDatabaseConfigured).toThrow("must target loopback");
  });

  test.each(["local", "production"] as const)(
    "rejects remote direct URLs even with %s deployment settings during development",
    (deployment) => {
      configureServerEnv({
        DATABASE_URL: "postgresql://user@database.invalid/quieter",
        QUIETER_DEPLOYMENT_ENV: deployment,
      });
      expect(assertDatabaseConfigured).toThrow("must target loopback");
    }
  );

  test("rejects linked URLs before a client can be created", () => {
    resources.AppDatabaseV2 = {
      connectionString: "postgresql://user@database.invalid/quieter",
    };
    expect(assertDatabaseConfigured).toThrow("must target loopback");
  });

  test.each([
    "postgresql://postgres@localhost/quieter",
    "postgresql://postgres@127.0.0.1/quieter",
    "postgresql://postgres@[::1]/quieter",
  ])("preserves direct and linked loopback URLs %s", (url) => {
    configureServerEnv({ DATABASE_URL: url });
    expect(assertDatabaseConfigured).not.toThrow();
    resources.AppDatabaseV2 = { connectionString: url };
    expect(assertDatabaseConfigured).not.toThrow();
  });

  test("preserves the allowlisted development database without runtime migration credentials", () => {
    configureServerEnv({
      DATABASE_MIGRATION_URL: undefined,
      DATABASE_URL:
        "postgresql://app@test.pg.psdb.cloud:6432/quieter_dev?sslmode=verify-full",
      QUIETER_LOCAL_PLANETSCALE_HOST: "test.pg.psdb.cloud",
    });
    expect(assertDatabaseConfigured).not.toThrow();
    resources.AppDatabaseV2 = {
      connectionString:
        "postgresql://app@test.pg.psdb.cloud:6432/quieter?sslmode=verify-full",
    };
    expect(assertDatabaseConfigured).toThrow("must target loopback");
  });
});
