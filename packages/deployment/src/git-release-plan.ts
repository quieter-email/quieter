import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { z } from "zod";

import { identifyAffectedRuntimes } from "./affected.ts";
import { runtimeRegistry } from "./registry.ts";

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
