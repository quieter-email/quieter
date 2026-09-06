import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { createGitReleasePlan } from "../src/git-release-plan.ts";

// oxlint-disable-next-line strict-void-return -- Node's callback API returns a ChildProcess while promisify waits for its callback.
const execute = promisify(execFile);

describe("immutable Git release planning", () => {
  let directory: string;
  let baselineSha: string;
  let skippedSha: string;
  let sourceSha: string;
  const git = async (...args: string[]) => {
    const result = await execute("git", args, {
      cwd: directory,
      windowsHide: true,
    });
    return result.stdout.trim();
  };
  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "quieter-release-plan-"));
    await git("init");
    await git("config", "user.email", "fixture@example.com");
    await git("config", "user.name", "Release fixture");
    await Promise.all(
      [
        ["apps/web", "@quieter/web"],
        ["packages/cloudflare", "@quieter/cloudflare"],
        ["packages/aws", "@quieter/aws"],
      ].map(async ([relative, name]) => {
        const root = path.join(directory, relative);
        await mkdir(root, { recursive: true });
        await writeFile(
          path.join(root, "package.json"),
          JSON.stringify({ name })
        );
      })
    );
    await git("add", ".");
    await git("commit", "-m", "fixture baseline");
    baselineSha = await git("rev-parse", "HEAD");
    await writeFile(
      path.join(directory, "apps/web/page.ts"),
      "export const page = 1;"
    );
    await git("add", ".");
    await git("commit", "-m", "skipped dashboard release");
    skippedSha = await git("rev-parse", "HEAD");
    await writeFile(
      path.join(directory, "packages/cloudflare/queue.ts"),
      "export const queue = 1;"
    );
    await git("add", ".");
    await git("commit", "-m", "next release");
    sourceSha = await git("rev-parse", "HEAD");
    await writeFile(
      path.join(directory, "packages/aws/dirty.ts"),
      "uncommitted work"
    );
  });

  afterAll(async () => {
    if (
      directory !== undefined &&
      path.dirname(path.resolve(directory)) === path.resolve(tmpdir()) &&
      path.basename(directory).startsWith("quieter-release-plan-")
    ) {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("includes skipped commits from the healthy baseline and ignores working-tree changes", async () => {
    const result = await createGitReleasePlan({
      baselineSha,
      directory,
      sourceSha,
    });
    expect(result.affected).toStrictEqual([
      "gmail-maintenance",
      "gmail-realtime",
      "gmail-sync",
      "mail-outbox-publisher",
      "mailbox-action-dispatch",
      "mailbox-actions",
      "web",
    ]);
    expect(result.runtimeOnly).toBeTruthy();
  });

  it("rejects an old run whose source is behind the healthy release", async () => {
    await expect(
      createGitReleasePlan({
        baselineSha: sourceSha,
        directory,
        sourceSha: skippedSha,
      })
    ).rejects.toThrow("healthy source");
  });

  it("does not rebuild unchanged services when the journal already records the source", async () => {
    const result = await createGitReleasePlan({
      baselineSha: sourceSha,
      directory,
      sourceSha,
    });
    expect(result.affected).toStrictEqual([]);
  });
});
