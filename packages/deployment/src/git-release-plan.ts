import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { z } from "zod";

import { identifyAffectedRuntimes } from "./affected.ts";
import type { ReleaseArtifactStore } from "./artifact-store.ts";
import { planPromotion } from "./compatibility.ts";
import { runtimeRegistry } from "./registry.ts";
import type { HealthyRelease } from "./schema.ts";
import { healthyReleaseSchema } from "./schema.ts";
import type { UploadReceipt } from "./upload.ts";

// oxlint-disable-next-line strict-void-return -- Node's callback API returns a ChildProcess while promisify waits for its callback.
const execute = promisify(execFile);
const shaSchema = z.string().regex(/^[a-f\d]{40}$/u);
const dependencySchema = z.record(z.string(), z.string()).default({});
const packageSchema = z.object({
  dependencies: dependencySchema,
  devDependencies: dependencySchema,
  name: z.string().min(1),
  optionalDependencies: dependencySchema,
  peerDependencies: dependencySchema,
});

export const createGitReleasePlan = async (input: {
  directory: string;
  baselineSha: string;
  sourceSha: string;
}) => {
  const baselineSha = shaSchema.parse(input.baselineSha);
  const sourceSha = shaSchema.parse(input.sourceSha);
  const git = async (args: string[]) => {
    const result = await execute("git", args, {
      cwd: input.directory,
      encoding: "utf-8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30_000,
      windowsHide: true,
    });
    return result.stdout;
  };
  // A release must include the recorded healthy source. Old reruns and divergent history fail closed.
  try {
    await git(["merge-base", "--is-ancestor", baselineSha, sourceSha]);
  } catch {
    throw new Error(
      "Candidate ancestry could not be verified against the healthy source. Fetch complete history and reject stale or divergent releases."
    );
  }
  const readPackages = async (sha: string) => {
    const tree = await git(["ls-tree", "-r", "--name-only", "-z", sha]);
    const files = tree.split("\0").filter(Boolean);
    const manifests = files.filter((file) =>
      /^(?:apps|packages)\/[\w-]+\/package\.json$/u.test(file)
    );
    if (manifests.length === 0 || manifests.length > 100) {
      throw new Error(
        "Workspace package inventory is missing or exceeds its bound."
      );
    }
    const packages = [];
    for (const file of manifests) {
      // oxlint-disable-next-line no-await-in-loop -- Bound Git subprocesses while reading immutable manifests.
      const contents = await git(["show", `${sha}:${file}`]);
      packages.push({
        directory: file.slice(0, -"/package.json".length),
        manifest: packageSchema.parse(JSON.parse(contents)),
      });
    }
    const names = new Set(packages.map((entry) => entry.manifest.name));
    return packages.map(({ directory, manifest }) => ({
      dependencies: [
        ...new Set(
          Object.entries({
            ...manifest.dependencies,
            ...manifest.devDependencies,
            ...manifest.optionalDependencies,
            ...manifest.peerDependencies,
          })
            .filter(
              ([name, version]) =>
                names.has(name) || version.startsWith("workspace:")
            )
            .map(([name]) => name)
        ),
      ],
      directory,
      name: manifest.name,
    }));
  };
  const [baselinePackages, candidatePackages, difference] = await Promise.all([
    readPackages(baselineSha),
    readPackages(sourceSha),
    git([
      "diff",
      "--name-only",
      "--no-renames",
      "-z",
      baselineSha,
      sourceSha,
      "--",
    ]),
  ]);
  const changes = identifyAffectedRuntimes({
    baselinePackages,
    candidatePackages,
    changedPaths: difference.split("\0").filter(Boolean),
    registry: runtimeRegistry,
  });
  return {
    ...changes,
    baselineSha,
    services: runtimeRegistry.filter((runtime) =>
      changes.affected.includes(runtime.service)
    ),
    sourceSha,
  };
};

export const verifyPlannedRelease = async (
  input: {
    baseline: HealthyRelease;
    candidate: HealthyRelease;
    plan: Awaited<ReturnType<typeof createGitReleasePlan>>;
  },
  artifacts: Pick<ReleaseArtifactStore, "read">
) => {
  const { baseline, candidate, plan } = input;
  if (
    plan.baselineSha !== baseline.sourceSha ||
    plan.sourceSha !== candidate.sourceSha ||
    !plan.runtimeOnly
  ) {
    throw new Error(
      "Automatic runtime release requires a matching source plan without infrastructure, tooling, or unclassified changes."
    );
  }
  const changed = planPromotion(baseline, candidate).toSorted();
  const affected = plan.affected.toSorted();
  if (
    changed.length !== affected.length ||
    changed.some((service, index) => service !== affected[index])
  ) {
    throw new Error(
      "The candidate must replace exactly the runtimes affected since the healthy source."
    );
  }
  for (const service of candidate.services) {
    if (!changed.includes(service.service)) {
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- Every changed runtime must come from the exact planned commit.
    const manifest = await artifacts.read(service.artifactDigest);
    if (manifest.artifact.sourceSha !== candidate.sourceSha) {
      throw new Error("A changed runtime was built from a different source.");
    }
    if (
      manifest.artifact.provenance === undefined ||
      (manifest.artifact.provenance.service ?? "web") !== service.service
    ) {
      throw new Error("A changed runtime was built for a different service.");
    }
  }
};

export const assembleReleaseCandidate = (input: {
  baseline: HealthyRelease;
  id: string;
  sourceSha: string;
  receipts: UploadReceipt[];
}): HealthyRelease => {
  const { baseline, receipts } = input;
  if (
    receipts.length === 0 ||
    new Set(receipts.map((receipt) => receipt.intent.scriptName)).size !==
      receipts.length ||
    receipts.some(
      (receipt) =>
        !baseline.services.some(
          (service) => service.scriptName === receipt.intent.scriptName
        )
    )
  ) {
    throw new Error("Choose one retained upload per existing changed runtime.");
  }
  const services = baseline.services.map((service) => {
    const receipt = receipts.find(
      (upload) => upload.intent.scriptName === service.scriptName
    );
    if (receipt === undefined) {
      return service;
    }
    if (
      receipt.intent.baseline.versionId !== service.versionId ||
      receipt.versionId === service.versionId
    ) {
      throw new Error(
        "The upload does not replace the current healthy version."
      );
    }
    return {
      ...service,
      artifactDigest: receipt.intent.artifactDigest,
      versionId: receipt.versionId,
    };
  });
  return healthyReleaseSchema.parse({
    id: input.id,
    services,
    sourceSha: input.sourceSha,
  });
};
