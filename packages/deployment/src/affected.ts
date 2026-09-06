import type { RuntimeRegistration } from "./registry.ts";

export type WorkspacePackage = {
  name: string;
  directory: string;
  dependencies: string[];
};

export const identifyAffectedRuntimes = (input: {
  changedPaths: string[];
  baselinePackages: WorkspacePackage[];
  candidatePackages: WorkspacePackage[];
  registry: RuntimeRegistration[];
}) => {
  const packages = new Map<
    string,
    { directories: Set<string>; dependencies: Set<string> }
  >();
  for (const snapshot of [input.baselinePackages, input.candidatePackages]) {
    if (new Set(snapshot.map((entry) => entry.name)).size !== snapshot.length) {
      throw new Error("Duplicate workspace package names.");
    }
    for (const entry of snapshot) {
      const existing = packages.get(entry.name) ?? {
        dependencies: new Set<string>(),
        directories: new Set<string>(),
      };
      existing.directories.add(entry.directory);
      for (const dependency of entry.dependencies) {
        existing.dependencies.add(dependency);
      }
      packages.set(entry.name, existing);
    }
  }
  const consumers = new Map<string, Set<string>>();
  for (const runtime of input.registry) {
    const visited = new Set<string>();
    const pending = [runtime.package];
    while (pending.length > 0) {
      const name = pending.pop();
      if (name === undefined || visited.has(name)) {
        continue;
      }
      visited.add(name);
      const entry = packages.get(name);
      if (entry === undefined) {
        throw new Error(`Missing workspace dependency: ${name}`);
      }
      const services = consumers.get(name) ?? new Set<string>();
      services.add(runtime.service);
      consumers.set(name, services);
      pending.push(...entry.dependencies);
    }
  }
  const affected = new Set<string>();
  const foundationPaths: string[] = [];
  const toolingPaths: string[] = [];
  const unclassifiedPaths: string[] = [];
  for (const file of input.changedPaths) {
    if (
      file.startsWith("/") ||
      file.includes("\\") ||
      file.split("/").some((part) => part === ".." || part === "")
    ) {
      throw new Error("Invalid repository change path.");
    }
    if (
      file.startsWith("docs/") ||
      /^[^/]+\.md$/u.test(file) ||
      file.startsWith(".agents/")
    ) {
      continue;
    }
    if (
      file === "packages/database/src/schema.ts" ||
      file === "packages/database/drizzle.config.ts" ||
      file.startsWith("infra/") ||
      /^sst(?:\.[\w-]+)*\.config\.ts$/u.test(file) ||
      file.startsWith("packages/database/drizzle/")
    ) {
      foundationPaths.push(file);
      for (const runtime of input.registry) {
        affected.add(runtime.service);
      }
      continue;
    }
    if (
      [
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "tsconfig.json",
        "vite.config.ts",
      ].includes(file) ||
      file.startsWith(".github/") ||
      file.startsWith("scripts/") ||
      file.startsWith("patches/") ||
      file.startsWith("packages/deployment/") ||
      file.startsWith("packages/config/")
    ) {
      toolingPaths.push(file);
      for (const runtime of input.registry) {
        affected.add(runtime.service);
      }
      continue;
    }
    const owners = [...packages.entries()].filter(([, entry]) =>
      [...entry.directories].some((directory) =>
        file.startsWith(`${directory}/`)
      )
    );
    if (owners.length !== 1 || !consumers.has(owners[0][0])) {
      unclassifiedPaths.push(file);
      continue;
    }
    for (const service of consumers.get(owners[0][0]) ?? []) {
      affected.add(service);
    }
  }
  return {
    affected: [...affected].toSorted(),
    foundationPaths: foundationPaths.toSorted(),
    runtimeOnly:
      foundationPaths.length === 0 &&
      toolingPaths.length === 0 &&
      unclassifiedPaths.length === 0,
    toolingPaths: toolingPaths.toSorted(),
    unclassifiedPaths: unclassifiedPaths.toSorted(),
  };
};
