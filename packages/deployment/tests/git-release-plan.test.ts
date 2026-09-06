import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import type { ReleaseArtifactStore } from "../src/artifact-store.ts";
import { artifactSchema } from "../src/artifact.ts";
import {
  createGitReleasePlan,
  verifyPlannedRelease,
} from "../src/git-release-plan.ts";

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
      timeout: 5000,
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
  }, 30_000);

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
      "mail-api",
      "mail-feedback-intake",
      "mail-outbox-publisher",
      "mail-projections",
      "mail-sender",
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

  /* oxlint-disable vitest/max-expects -- Verify one complete candidate against the independent plan and retained source evidence. */
  it("preserves unaffected runtimes and rejects incomplete or stale candidates", async () => {
    const plan = await createGitReleasePlan({
      baselineSha,
      directory,
      sourceSha: skippedSha,
    });
    const artifact = artifactSchema.parse({
      assetRouting: {},
      assets: [],
      buildId: "fixture",
      compatibilityDate: "2026-08-04",
      compatibilityFlags: [],
      mainModule: "index.js",
      modules: [
        {
          bytes: 1,
          contentType: "application/javascript+module",
          digest: "a".repeat(64),
          path: "index.js",
        },
      ],
      schemaVersion: 1,
      sourceSha: skippedSha,
    });
    const manifest = {
      archive: null,
      artifact,
      digest: createHash("sha256")
        .update(JSON.stringify(artifact))
        .digest("hex"),
    };
    const artifacts = {
      read: vi.fn<ReleaseArtifactStore["read"]>().mockResolvedValue(manifest),
    };
    const baseline = {
      id: "baseline",
      services: ["web", "gmail-sync"].map((service) => ({
        artifactDigest: "b".repeat(64),
        bindingGeneration: "c".repeat(64),
        contracts: [],
        requirements: {},
        scriptName: `test-${service}`,
        service,
        versionId: randomUUID(),
      })),
      sourceSha: baselineSha,
    };
    const candidate = {
      ...baseline,
      id: "candidate",
      services: baseline.services.map((service) =>
        service.service === "web"
          ? {
              ...service,
              artifactDigest: manifest.digest,
              versionId: randomUUID(),
            }
          : service
      ),
      sourceSha: skippedSha,
    };
    await verifyPlannedRelease({ baseline, candidate, plan }, artifacts);
    expect(artifacts.read).toHaveBeenCalledExactlyOnceWith(manifest.digest);
    await expect(
      verifyPlannedRelease(
        {
          baseline,
          candidate,
          plan: { ...plan, affected: ["gmail-sync", "web"] },
        },
        artifacts
      )
    ).rejects.toThrow("exactly the runtimes");
    await expect(
      verifyPlannedRelease(
        { baseline, candidate, plan: { ...plan, affected: [] } },
        artifacts
      )
    ).rejects.toThrow("exactly the runtimes");
    await expect(
      verifyPlannedRelease(
        { baseline, candidate, plan: { ...plan, runtimeOnly: false } },
        artifacts
      )
    ).rejects.toThrow("matching source plan");
    await expect(
      verifyPlannedRelease(
        { baseline, candidate, plan: { ...plan, baselineSha: sourceSha } },
        artifacts
      )
    ).rejects.toThrow("matching source plan");
    artifacts.read.mockResolvedValue({
      ...manifest,
      artifact: { ...artifact, sourceSha: baselineSha },
    });
    await expect(
      verifyPlannedRelease({ baseline, candidate, plan }, artifacts)
    ).rejects.toThrow("different source");
  });
  /* oxlint-enable vitest/max-expects */
});
