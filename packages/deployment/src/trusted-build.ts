import { createHash } from "node:crypto";

import { z } from "zod";

import { digestSchema, identifierSchema } from "./schema.ts";

const shaSchema = z.string().regex(/^[a-f\d]{40}$/u);
const repositorySchema = z.string().regex(/^[\w.-]+\/[\w.-]+$/u);
const runSchema = z.object({
  conclusion: z.literal("success"),
  event: z.enum(["push", "workflow_dispatch"]),
  head_branch: z.literal("main"),
  head_repository: z.object({
    full_name: repositorySchema,
    id: z.number().int().positive(),
  }),
  head_sha: shaSchema,
  id: z.number().int().positive(),
  path: z.literal(".github/workflows/release-build.yml"),
  repository: z.object({
    full_name: repositorySchema,
    id: z.number().int().positive(),
  }),
  run_attempt: z.number().int().positive(),
  status: z.literal("completed"),
});
const githubArtifactSchema = z.object({
  digest: z.string().regex(/^sha256:[a-f\d]{64}$/u),
  expired: z.literal(false),
  id: z.number().int().positive(),
  name: z.string(),
  size_in_bytes: z.number().int().positive().max(400_000_000),
  workflow_run: z.object({
    head_branch: z.literal("main"),
    head_repository_id: z.number().int().positive(),
    head_sha: shaSchema,
    id: z.number().int().positive(),
    repository_id: z.number().int().positive(),
  }),
});

export const trustedBuildSchema = z.strictObject({
  archiveDigest: digestSchema,
  artifactId: z.number().int().positive(),
  artifactName: identifierSchema,
  lockfileDigest: digestSchema,
  publicConfigurationDigest: digestSchema,
  repository: repositorySchema,
  runAttempt: z.number().int().positive(),
  runId: z.number().int().positive(),
  schemaVersion: z.literal(1),
  service: identifierSchema.optional(),
  sourceSha: shaSchema,
  sourceTree: shaSchema,
  stage: identifierSchema,
});
export type TrustedBuild = z.infer<typeof trustedBuildSchema>;

export const verifyTrustedBuild = async (
  input: {
    expectedArtifact?: { id: number; digest: string };
    repository: string;
    runId: number;
    stage: string;
    publicConfigurationDigest: string;
    token: string;
    service?: string;
  },
  request: typeof fetch = fetch
) => {
  const repository = repositorySchema.parse(input.repository);
  const runId = z.number().int().positive().parse(input.runId);
  const service = identifierSchema.parse(input.service ?? "web");
  const api = `https://api.github.com/repos/${repository}`;
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${input.token}`,
    "x-github-api-version": "2026-03-10",
  };
  const read = async (suffix: string): Promise<unknown> => {
    const response = await request(`${api}${suffix}`, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error("Cannot verify the trusted build with GitHub.");
    }
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 8_000_000) {
        throw new Error(
          "GitHub build verification response exceeded its bound."
        );
      }
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  };
  const run = runSchema.parse(await read(`/actions/runs/${runId}`));
  if (
    run.id !== runId ||
    run.repository.full_name !== repository ||
    run.head_repository.full_name !== repository ||
    run.head_repository.id !== run.repository.id
  ) {
    throw new Error("Release build must originate in the trusted repository.");
  }
  const comparison = z
    .object({
      base_commit: z.object({ sha: shaSchema }),
      status: z.enum(["ahead", "identical"]),
    })
    .parse(await read(`/compare/${run.head_sha}...main`));
  if (comparison.base_commit.sha !== run.head_sha) {
    throw new Error("Release build source is not in trusted main history.");
  }
  const name = `${service}-release-${run.head_sha}-${run.run_attempt}`;
  const artifacts = z
    .object({
      artifacts: z.array(z.unknown()).max(100),
      total_count: z.number().int().min(1).max(100),
    })
    .parse(await read(`/actions/runs/${runId}/artifacts?per_page=100`));
  const selected = artifacts.artifacts.filter(
    (artifact) =>
      z.object({ name: z.literal(name) }).safeParse(artifact).success
  );
  if (selected.length !== 1) {
    throw new Error(
      "The trusted run must have exactly one artifact for its completed attempt."
    );
  }
  const artifact = githubArtifactSchema.parse(selected[0]);
  if (
    input.expectedArtifact !== undefined &&
    (artifact.id !== input.expectedArtifact.id ||
      artifact.digest !== `sha256:${input.expectedArtifact.digest}`)
  ) {
    throw new Error(
      "The selected artifact changed while the build was being verified."
    );
  }
  if (
    artifact.workflow_run.id !== runId ||
    artifact.workflow_run.repository_id !== run.repository.id ||
    artifact.workflow_run.head_repository_id !== run.repository.id ||
    artifact.workflow_run.head_sha !== run.head_sha
  ) {
    throw new Error(
      "Release artifact does not belong to the verified source run."
    );
  }
  const commit = z
    .object({
      commit: z.object({ tree: z.object({ sha: shaSchema }) }),
      sha: shaSchema,
    })
    .parse(await read(`/commits/${run.head_sha}`));
  const lockfile = z
    .object({
      content: z.string().max(6_000_000),
      encoding: z.literal("base64"),
      size: z.number().int().positive().max(4_000_000),
    })
    .parse(await read(`/contents/pnpm-lock.yaml?ref=${run.head_sha}`));
  const lockBytes = Buffer.from(lockfile.content, "base64");
  if (commit.sha !== run.head_sha || lockBytes.byteLength !== lockfile.size) {
    throw new Error("Trusted build source metadata is inconsistent.");
  }
  const archiveResponse = await request(
    `${api}/actions/artifacts/${artifact.id}/zip`,
    { headers, redirect: "manual", signal: AbortSignal.timeout(15_000) }
  );
  const location = archiveResponse.headers.get("location");
  await archiveResponse.body?.cancel();
  if (archiveResponse.status !== 302 || location === null) {
    throw new Error("GitHub did not provide the immutable build archive.");
  }
  const url = new URL(location);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    !(
      url.hostname.endsWith(".blob.core.windows.net") ||
      url.hostname.endsWith(".actions.githubusercontent.com")
    )
  ) {
    throw new Error("GitHub artifact download destination is not supported.");
  }
  // Signed artifact storage requests must never receive the GitHub credential.
  const archive = await request(url, {
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
  }).catch(() => {
    throw new Error("Cannot read the immutable build archive.");
  });
  if (!archive.ok || !archive.body) {
    await archive.body?.cancel();
    throw new Error("Cannot read the immutable build archive.");
  }
  let bytes = 0;
  const hash = createHash("sha256");
  for await (const chunk of archive.body) {
    bytes += chunk.byteLength;
    if (bytes > 400_000_000) {
      throw new Error("Build archive exceeded the download bound.");
    }
    hash.update(chunk);
  }
  const digest = hash.digest("hex");
  if (digest !== artifact.digest.slice("sha256:".length)) {
    throw new Error("Downloaded build archive does not match GitHub's digest.");
  }
  return trustedBuildSchema.parse({
    archiveDigest: digest,
    artifactId: artifact.id,
    artifactName: name,
    lockfileDigest: createHash("sha256").update(lockBytes).digest("hex"),
    publicConfigurationDigest: input.publicConfigurationDigest,
    repository,
    runAttempt: run.run_attempt,
    runId,
    schemaVersion: 1,
    service,
    sourceSha: run.head_sha,
    sourceTree: commit.commit.tree.sha,
    stage: input.stage,
  });
};
