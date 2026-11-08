import { parseEnv } from "node:util";

import { describe, expect, test } from "vite-plus/test";

import { serializeEnvFile } from "./local-doctor";

describe("local configuration", () => {
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
});
