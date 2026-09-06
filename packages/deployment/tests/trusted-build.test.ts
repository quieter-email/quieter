import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vite-plus/test";

import { verifyTrustedBuild } from "../src/trusted-build.ts";

const fixture = () => {
  const sourceSha = "a".repeat(40);
  const archive = Buffer.from("immutable archive fixture");
  const lockfile = Buffer.from("lockfileVersion: 9\n");
  const run = {
    conclusion: "success",
    event: "push",
    head_branch: "main",
    head_repository: { full_name: "fixture/repository", id: 42 },
    head_sha: sourceSha,
    id: 123,
    path: ".github/workflows/release-build.yml",
    repository: { full_name: "fixture/repository", id: 42 },
    run_attempt: 2,
    status: "completed",
  };
  const artifact = {
    digest: `sha256:${createHash("sha256").update(archive).digest("hex")}`,
    expired: false,
    id: 456,
    name: `web-release-${sourceSha}-2`,
    size_in_bytes: archive.byteLength,
    workflow_run: {
      head_branch: "main",
      head_repository_id: 42,
      head_sha: sourceSha,
      id: 123,
      repository_id: 42,
    },
  };
  const responses = new Map<string, unknown>([
    ["/actions/runs/123", run],
    [
      `/compare/${sourceSha}...main`,
      { base_commit: { sha: sourceSha }, status: "ahead" },
    ],
    [
      "/actions/runs/123/artifacts?per_page=100",
      { artifacts: [artifact], total_count: 1 },
    ],
    [
      `/commits/${sourceSha}`,
      { commit: { tree: { sha: "b".repeat(40) } }, sha: sourceSha },
    ],
    [
      `/contents/pnpm-lock.yaml?ref=${sourceSha}`,
      {
        content: lockfile.toString("base64"),
        encoding: "base64",
        size: lockfile.byteLength,
      },
    ],
  ]);
  const request = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (
      url === "https://fixture.blob.core.windows.net/artifact?signature=test"
    ) {
      return await Promise.resolve(new Response(archive));
    }
    if (url.endsWith("/actions/artifacts/456/zip")) {
      return await Promise.resolve(
        new Response(null, {
          headers: {
            location:
              "https://fixture.blob.core.windows.net/artifact?signature=test",
          },
          status: 302,
        })
      );
    }
    const suffix = url.replace(
      "https://api.github.com/repos/fixture/repository",
      ""
    );
    if (!responses.has(suffix)) {
      throw new Error("Unexpected verification request");
    }
    return await Promise.resolve(Response.json(responses.get(suffix)));
  });
  return { archive, artifact, lockfile, request, responses, run, sourceSha };
};

const input = {
  publicConfigurationDigest: "d".repeat(64),
  repository: "fixture/repository",
  runId: 123,
  stage: "production",
  token: "test-read-token",
};

describe("trusted main build authorization", () => {
  it("selects the requested runtime's immutable artifact", async () => {
    const data = fixture();
    await expect(
      verifyTrustedBuild({ ...input, service: "mail-sender" }, data.request)
    ).rejects.toThrow("artifact");
    data.artifact.name = `mail-sender-release-${data.sourceSha}-2`;
    await expect(
      verifyTrustedBuild({ ...input, service: "mail-sender" }, data.request)
    ).resolves.toMatchObject({
      artifactId: data.artifact.id,
      service: "mail-sender",
    });
  });

  it("rejects a selected artifact replaced between verification and download", async () => {
    const data = fixture();
    await expect(
      verifyTrustedBuild(
        {
          ...input,
          expectedArtifact: { digest: data.artifact.digest.slice(7), id: 999 },
        },
        data.request
      )
    ).rejects.toThrow("selected artifact changed");
    await expect(
      verifyTrustedBuild(
        { ...input, expectedArtifact: { digest: "f".repeat(64), id: 456 } },
        data.request
      )
    ).rejects.toThrow("selected artifact changed");
  });

  it("verifies the successful attempt, immutable archive digest, and source metadata without forwarding credentials", async () => {
    const value = fixture();
    const result = await verifyTrustedBuild(input, value.request);
    expect(result).toMatchObject({
      artifactId: 456,
      lockfileDigest: createHash("sha256").update(value.lockfile).digest("hex"),
      runAttempt: 2,
      runId: 123,
      sourceSha: value.sourceSha,
    });
    const storageRequest = value.request.mock.calls.find(([url]) =>
      (url instanceof Request ? url.url : url.toString()).includes(
        "blob.core.windows.net"
      )
    );
    expect(storageRequest?.[1]?.headers).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(input.token);
  });

  it.each([
    { field: "event", value: "pull_request" },
    { field: "head_branch", value: "feature" },
    { field: "conclusion", value: "failure" },
    { field: "path", value: ".github/workflows/ci-main.yml" },
    { field: "status", value: "in_progress" },
  ])(
    "rejects an unauthorized run with $field=$value before downloading artifacts",
    async ({ field, value }) => {
      const data = fixture();
      Object.assign(data.run, { [field]: value });
      await expect(verifyTrustedBuild(input, data.request)).rejects.toThrow(
        field
      );
      expect(data.request).toHaveBeenCalledOnce();
    }
  );

  it("rejects a same-named branch from a fork and source history removed from main", async () => {
    const data = fixture();
    data.run.head_repository.id = 999;
    await expect(verifyTrustedBuild(input, data.request)).rejects.toThrow(
      "trusted repository"
    );
    data.run.head_repository.id = 42;
    data.responses.set(`/compare/${data.sourceSha}...main`, {
      base_commit: { sha: data.sourceSha },
      status: "diverged",
    });
    await expect(verifyTrustedBuild(input, data.request)).rejects.toThrow(
      "status"
    );
  });

  it("rejects stale rerun artifacts and artifacts belonging to another run", async () => {
    const data = fixture();
    data.artifact.name = `web-release-${data.sourceSha}-1`;
    await expect(verifyTrustedBuild(input, data.request)).rejects.toThrow(
      "completed attempt"
    );
    data.artifact.name = `web-release-${data.sourceSha}-2`;
    data.artifact.workflow_run.id = 999;
    await expect(verifyTrustedBuild(input, data.request)).rejects.toThrow(
      "verified source run"
    );
  });

  it("rejects expired artifacts and treats a download checksum mismatch as a failure", async () => {
    const data = fixture();
    data.artifact.expired = true;
    await expect(verifyTrustedBuild(input, data.request)).rejects.toThrow(
      "expired"
    );
    data.artifact.expired = false;
    data.artifact.digest = `sha256:${"f".repeat(64)}`;
    await expect(verifyTrustedBuild(input, data.request)).rejects.toThrow(
      "GitHub's digest"
    );
  });
});
