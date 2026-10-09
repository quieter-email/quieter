import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vite-plus/test";

let directory = "";
describe("prepared SST build", () => {
  afterEach(async () => {
    if (directory !== "") {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test.each(["diff", "refresh", "deploy"])(
    "prepares a fresh %s build, reuses exact output, and rejects tampering",
    async (mode) => {
      directory = await mkdtemp(path.join(os.tmpdir(), "quieter-build-"));
      const cwd = path.join(directory, "apps/web");
      await mkdir(cwd, { recursive: true });
      await mkdir(path.join(directory, ".sst"));
      const configPath = path.join(directory, "wrangler.json");
      await writeFile(configPath, '{"vars":{"stage":"test"}}');
      await writeFile(
        path.join(directory, "fixture.cjs"),
        `
const fs = require('node:fs');
fs.mkdirSync('.cloudflare/output/v0/workers/default/assets/assets', {recursive: true});
fs.mkdirSync('.cloudflare/output/v0/workers/default/bundle', {recursive: true});
fs.writeFileSync('.cloudflare/output/v0/workers/default/assets/assets/build-id.txt', 'test-build');
fs.writeFileSync('.cloudflare/output/v0/config.json', '{}');
fs.writeFileSync('.cloudflare/output/v0/workers/default/worker.config.json', '{}');
fs.writeFileSync('.cloudflare/output/v0/workers/default/bundle/index.js', 'original');
fs.appendFileSync('build-calls.txt', 'built\\n');
`
      );
      await writeFile(
        path.join(directory, process.platform === "win32" ? "vp.cmd" : "vp"),
        process.platform === "win32"
          ? `@"${process.execPath}" "${path.join(directory, "fixture.cjs")}"\r\n`
          : `#!/bin/sh\n"${process.execPath}" "${path.join(directory, "fixture.cjs")}"\n`,
        { mode: 0o700 }
      );
      const options = {
        cwd,
        encoding: "utf-8",
        env: {
          ...process.env,
          PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
          QUIETER_BUILD_ID: "test-build",
          SENTRY_AUTH_TOKEN: "fixture",
          SENTRY_ORG: "fixture",
          SENTRY_PROJECT: "fixture",
          SST_WRANGLER_PATH: configPath,
        },
      } as const;
      const script = path.resolve(import.meta.dirname, "prepared-web-build.ts");
      const missingUploadConfiguration = spawnSync(
        process.execPath,
        [script, mode],
        {
          ...options,
          env: { ...options.env, SENTRY_AUTH_TOKEN: "" },
        }
      );
      expect(missingUploadConfiguration.status).not.toBe(0);
      const prepare = spawnSync(process.execPath, [script, mode], options);
      expect(prepare.status).toBe(0);
      const deploy = spawnSync(process.execPath, [script, "deploy"], options);
      expect(deploy.status).toBe(0);
      const markerPath = path.join(
        cwd,
        ".cloudflare/output/v0/workers/default/assets/assets/build-id.txt"
      );
      await rm(markerPath);
      expect(
        spawnSync(process.execPath, [script, "deploy"], options).status
      ).not.toBe(0);
      await writeFile(markerPath, "test-build");
      await writeFile(
        path.join(cwd, ".cloudflare/output/v0/workers/default/bundle/index.js"),
        "changed"
      );
      expect(
        spawnSync(process.execPath, [script, "deploy"], options).status
      ).not.toBe(0);
      await writeFile(
        path.join(cwd, ".cloudflare/output/v0/workers/default/bundle/index.js"),
        "original"
      );
      await writeFile(configPath, '{"vars":{"stage":"other"}}');
      expect(
        spawnSync(process.execPath, [script, "deploy"], options).status
      ).not.toBe(0);
      const buildCalls = await readFile(
        path.join(cwd, "build-calls.txt"),
        "utf-8"
      );
      expect(buildCalls.split("\n").filter(Boolean)).toHaveLength(1);
    }
  );
});
