import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  createWebBuildEnv,
  createWebReleaseEnvironment,
} from "@quieter/env/build";
import { describe, expect, it } from "vite-plus/test";

import { readReleaseBuildSource } from "../src/runtime-release-build.ts";

// oxlint-disable-next-line strict-void-return -- promisify waits for the subprocess callback.
const execute = promisify(execFile);

describe("controlled release build inputs", () => {
  it("drops inherited secrets and undeclared build variables while preserving declared public defaults", () => {
    const result = createWebReleaseEnvironment(
      { VITE_PUBLIC_POSTHOG_HOST: "https://telemetry.example.com" },
      {
        AWS_SECRET_ACCESS_KEY: "private-fixture",
        NODE_OPTIONS: "--require ./untracked.js",
        Path: "fixture-path",
        QUIETER_BUILD_ID: "old-build",
        SENTRY_AUTH_TOKEN: "private-fixture",
        SST_RESOURCES_JSON: "private-fixture",
        SYSTEMROOT: "fixture-system",
        VITE_PUBLIC_POSTHOG_HOST: "https://wrong.example.com",
        VITE_UNDECLARED: "private-fixture",
      }
    );
    expect(result.environment).toStrictEqual({
      Path: "fixture-path",
      SYSTEMROOT: "fixture-system",
    });
    expect(result.publicConfiguration).toMatchObject({
      VITE_PUBLIC_POSTHOG_HOST: "https://telemetry.example.com",
      VITE_QUIETER_LOCAL_TELEMETRY: "false",
      VITE_QUIETER_PREVIEW_PERSONAS_ENABLED: "false",
    });
    expect(() =>
      createWebReleaseEnvironment({ VITE_UNDECLARED: "private-fixture" })
    ).toThrow("only supported public");
    expect(() => createWebBuildEnv({ QUIETER_RELEASE_BUILD: "true" })).toThrow(
      "Invalid web build"
    );
  });

  it("records immutable Git identity and refuses modified, staged, or untracked source", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "quieter-build-source-")
    );
    const git = async (...args: string[]) => {
      const result = await execute("git", args, {
        cwd: directory,
        windowsHide: true,
      });
      return result.stdout.trim();
    };
    try {
      await git("init");
      await git("config", "user.email", "fixture@example.com");
      await git("config", "user.name", "Release fixture");
      await writeFile(
        path.join(directory, "pnpm-lock.yaml"),
        "lockfile fixture\n"
      );
      await writeFile(path.join(directory, ".gitignore"), ".env.local\n");
      await git("add", ".");
      await git("commit", "-m", "fixture source");
      await writeFile(
        path.join(directory, ".env.local"),
        "PRIVATE=not-a-build-input\n"
      );
      const source = await readReleaseBuildSource(directory);
      expect(source).toStrictEqual({
        lockfileDigest: createHash("sha256")
          .update("lockfile fixture\n")
          .digest("hex"),
        sourceSha: await git("rev-parse", "HEAD"),
        sourceTree: await git("rev-parse", "HEAD^{tree}"),
      });
      await writeFile(path.join(directory, "pnpm-lock.yaml"), "changed\n");
      await expect(readReleaseBuildSource(directory)).rejects.toThrow(
        "clean checkout"
      );
      await git("add", "pnpm-lock.yaml");
      await expect(readReleaseBuildSource(directory)).rejects.toThrow(
        "clean checkout"
      );
      await git("commit", "-m", "fixture changed lock");
      const changedSource = await readReleaseBuildSource(directory);
      expect(changedSource.sourceSha).not.toBe(source.sourceSha);
      await writeFile(
        path.join(directory, "untracked.ts"),
        "export const changed = true;"
      );
      await expect(readReleaseBuildSource(directory)).rejects.toThrow(
        "untracked source"
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it.each([".env.sentry-build-plugin", ".sentryclirc"])(
    "rejects implicit %s configuration before building",
    async (file) => {
      const directory = await mkdtemp(
        path.join(tmpdir(), "quieter-build-config-")
      );
      try {
        await writeFile(path.join(directory, file), "PRIVATE=fixture\n");
        await expect(readReleaseBuildSource(directory)).rejects.toThrow(
          "implicit Sentry configuration"
        );
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    }
  );
});
