import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";

import { describe, expect, test } from "vite-plus/test";

import { parseEnvFile, serializeEnvFile } from "./local-doctor";
import { createServerEnv } from "./server";

describe("local configuration", () => {
  test("local env files use Node quoting and comment rules", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "quieter-env-"));
    try {
      const envPath = path.join(directory, ".env");
      await writeFile(
        envPath,
        'TOKEN=abc123 # local only\nLABEL="quoted value" # comment\nEMPTY=\n'
      );
      expect(parseEnvFile(envPath)).toStrictEqual(
        new Map([
          ["TOKEN", "abc123"],
          ["LABEL", "quoted value"],
        ])
      );
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  test("dotenv serialization preserves quoted and multiline values", () => {
    const values = new Map([
      ["TOKEN", 'path\\with\\"quotes"'],
      ["LABEL", "a 'quoted' label"],
      ["MULTILINE", "first\nsecond"],
      ["EMPTY", ""],
    ]);
    expect({ ...parseEnv(serializeEnvFile(values)) }).toStrictEqual(
      Object.fromEntries(values)
    );
    expect(() => serializeEnvFile(new Map([["TOKEN", "'\"`"]]))).toThrow(
      /represented/u
    );
  });

  test.each(["0", "-1", "no", "1.5", "100"])(
    "rejects invalid backfill concurrency %s",
    (value) => {
      expect(() =>
        createServerEnv({ BACKFILL_CONCURRENCY: value, NODE_ENV: "test" })
      ).toThrow(Error);
    }
  );
});
