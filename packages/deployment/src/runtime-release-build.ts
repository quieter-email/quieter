import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify, stripVTControlCharacters } from "node:util";

import { createWebReleaseEnvironment } from "@quieter/env/build";
import SentryCli from "@sentry/cli";
import { z } from "zod";

import type { buildProvenanceSchema } from "./artifact.ts";
import {
  inventoryWorkerArtifact,
  readArtifactFile,
  releaseArtifactSchema,
} from "./artifact.ts";
import { inventoryAssets } from "./assets.ts";
import { runtimeRegistry } from "./registry.ts";
import { identifierSchema } from "./schema.ts";
import {
  prepareGeneratedSourceMaps,
  verifyReleaseSourceMaps,
} from "./source-maps.ts";

// oxlint-disable-next-line strict-void-return -- promisify waits for the subprocess callback.
const execute = promisify(execFile);

export const readReleaseBuildSource = async (directory: string) => {
  for (const root of [directory, path.join(directory, "apps/web")]) {
    for (const file of [".env.sentry-build-plugin", ".sentryclirc"]) {
      // oxlint-disable-next-line no-await-in-loop -- Reject implicit plugin configuration even when Git ignores it.
      const exists = await lstat(path.join(root, file)).then(
        () => true,
        (error: unknown) => {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          ) {
            return false;
          }
          throw new Error("Could not inspect implicit build configuration.");
        }
      );
      if (exists) {
        throw new Error(
          "Release builds reject implicit Sentry configuration files."
        );
      }
    }
  }
  const git = async (args: string[]) => {
    const result = await execute("git", args, {
      cwd: directory,
      encoding: "utf-8",
      maxBuffer: 4_000_000,
      timeout: 30_000,
      windowsHide: true,
    });
    return result.stdout.trim();
  };
  if ((await git(["status", "--porcelain", "--untracked-files=all"])) !== "") {
    throw new Error(
      "A release build requires a clean checkout, including untracked source files."
    );
  }
  const sha = z.string().regex(/^[a-f\d]{40}$/u);
  const [sourceSha, sourceTree, lockfile] = await Promise.all([
    git(["rev-parse", "HEAD"]),
    git(["rev-parse", "HEAD^{tree}"]),
    readFile(path.join(directory, "pnpm-lock.yaml")),
  ]);
  return {
    lockfileDigest: createHash("sha256").update(lockfile).digest("hex"),
    sourceSha: sha.parse(sourceSha),
    sourceTree: sha.parse(sourceTree),
  };
};

export const buildRuntimeRelease = async (input: {
  directory: string;
  output: string;
  stage: string;
  publicConfiguration: unknown;
  service: string;
}) => {
  if (!path.isAbsolute(input.directory) || !path.isAbsolute(input.output)) {
    throw new Error("Release build paths must be absolute.");
  }
  const stage = identifierSchema.parse(input.stage);
  const runtime = runtimeRegistry.find(
    (entry) => entry.service === input.service
  );
  if (
    runtime === undefined ||
    !["@quieter/web", "@quieter/cloudflare"].includes(runtime.package)
  ) {
    throw new Error(
      "Controlled builds require a registered Cloudflare runtime."
    );
  }
  const web = runtime.service === "web";
  const source = await readReleaseBuildSource(input.directory);
  const { environment, publicConfiguration } = createWebReleaseEnvironment(
    input.publicConfiguration
  );
  const vp = process.platform === "win32" ? "vp.exe" : "vp";
  const toolchainResult = await execute(vp, ["--version"], {
    cwd: input.directory,
    encoding: "utf-8",
    env: environment,
    timeout: 30_000,
    windowsHide: true,
  });
  const toolchain = stripVTControlCharacters(toolchainResult.stdout).trim();
  // A new directory makes incomplete builds visible and prevents overwriting previously verified bytes.
  await mkdir(input.output);
  const configPath = path.join(input.output, "build-worker.jsonc");
  const entryPath = path.join(input.output, "index.ts");
  const entryModule = JSON.stringify(
    path.join(input.directory, runtime.entrypoint).replaceAll("\\", "/")
  );
  const entrySource = `export { default } from ${entryModule};\nexport * from ${entryModule};\n`;
  if (!web) {
    await writeFile(entryPath, entrySource, { flag: "wx" });
  }
  const buildId = randomUUID();
  const run = async (
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv
  ) => {
    // oxlint-disable-next-line promise/avoid-new -- Adapt streamed subprocess completion without buffering build output.
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: input.directory,
        env,
        stdio: "inherit",
        timeout: 600_000,
        windowsHide: true,
      });
      child.once("error", () => {
        reject(new Error("Release build subprocess could not start."));
      });
      child.once("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              "Release build subprocess failed; no completion manifest was written."
            )
          );
        }
      });
    });
  };
  await run(
    process.execPath,
    [
      "packages/cloudflare/scripts/write-build-wrangler.ts",
      "--name",
      "quieter-release-build",
      "--main",
      web ? path.join(input.directory, runtime.entrypoint) : entryPath,
      "--out",
      configPath,
    ],
    environment
  );
  const buildConfig = await readFile(configPath);
  const buildEnvironment = {
    ...environment,
    ...publicConfiguration,
    CI: "true",
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    NODE_ENV: "production",
    QUIETER_BUILD_ID: buildId,
    QUIETER_RELEASE_BUILD: "true",
    QUIETER_RELEASE_STAGE: stage,
    SST_WRANGLER_PATH: configPath,
  };
  for (const task of [
    "@quieter/env#build",
    "@quieter/observability#build",
    ...(web ? ["@quieter/web#build"] : []),
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- Build dependencies before the one web build, without task-cache reuse.
    await run(vp, ["run", "--no-cache", task], buildEnvironment);
  }
  const builtDirectory = web
    ? path.join(input.directory, "apps/web/dist")
    : path.join(input.output, "build");
  if (!web) {
    await mkdir(path.join(builtDirectory, "client"), { recursive: true });
    await mkdir(path.join(builtDirectory, "server"), { recursive: true });
    await run(
      vp,
      [
        "exec",
        "wrangler",
        "deploy",
        "--dry-run",
        "--config",
        configPath,
        "--outdir",
        path.join(builtDirectory, "server"),
        "--minify",
        "--upload-source-maps",
      ],
      buildEnvironment
    );
    await writeFile(
      path.join(builtDirectory, "server/wrangler.json"),
      buildConfig,
      { flag: "wx" }
    );
  }
  await prepareGeneratedSourceMaps(builtDirectory);
  await run(
    SentryCli.getPath(),
    [
      "sourcemaps",
      "inject",
      "--quiet",
      path.join(builtDirectory, "client"),
      path.join(builtDirectory, "server"),
    ],
    environment
  );
  if (
    web &&
    (await readFile(
      path.join(builtDirectory, "client/assets/build-id.txt"),
      "utf-8"
    )) !== buildId
  ) {
    throw new Error(
      "The web build did not produce the requested build identity."
    );
  }
  const sourceMaps: z.infer<typeof buildProvenanceSchema>["sourceMaps"] = [];
  const pending = ["client", "server"];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    // oxlint-disable-next-line no-await-in-loop -- Bound private map inventory and copying.
    const entries = await readdir(path.join(builtDirectory, current), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new Error("Release builds cannot contain symlinks.");
      }
      const relative = `${current}/${entry.name}`;
      if (entry.isDirectory()) {
        pending.push(relative);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".map")) {
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop -- Read and retain one private source map at a time.
      const body = await readFile(path.join(builtDirectory, relative));
      const file = {
        bytes: body.byteLength,
        contentType: "application/json" as const,
        digest: createHash("sha256").update(body).digest("hex"),
        path: relative,
      };
      sourceMaps.push(file);
      const destination = path.join(input.output, "source-maps", relative);
      // oxlint-disable-next-line no-await-in-loop -- Each destination depends on its discovered relative path.
      await mkdir(path.dirname(destination), { recursive: true });
      // oxlint-disable-next-line no-await-in-loop -- Retain private maps outside the public asset tree.
      await writeFile(destination, body, { flag: "wx" });
    }
  }
  const { artifact, digest } = await inventoryWorkerArtifact(
    builtDirectory,
    buildId,
    source.sourceSha,
    {
      buildConfigDigest: createHash("sha256")
        .update(buildConfig)
        .update(web ? "" : entrySource)
        .digest("hex"),
      command: web
        ? "vp run --no-cache @quieter/web#build"
        : "vp exec wrangler deploy --dry-run",
      lockfileDigest: source.lockfileDigest,
      nodeVersion: process.version,
      publicConfigurationDigest: createHash("sha256")
        .update(JSON.stringify(publicConfiguration))
        .digest("hex"),
      service: runtime.service,
      sourceMaps: sourceMaps.toSorted((a, b) => a.path.localeCompare(b.path)),
      sourceTree: source.sourceTree,
      stage,
      toolchain,
    }
  );
  const files = [
    ...artifact.modules.map((file) => ({
      file,
      root: ["_headers", "_redirects"].includes(file.path)
        ? "client"
        : "server",
    })),
    ...artifact.assets.map((file) => ({ file, root: "client" })),
  ];
  for (let offset = 0; offset < files.length; offset += 5) {
    // oxlint-disable-next-line no-await-in-loop -- Copy only bytes that match the inventory, in bounded batches.
    await Promise.all(
      files.slice(offset, offset + 5).map(async ({ file, root }) => {
        const body = await readArtifactFile(
          path.join(builtDirectory, root),
          file
        );
        const destination = path.join(input.output, root, file.path);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, body, { flag: "wx" });
      })
    );
  }
  const archive = web
    ? await inventoryAssets(path.join(input.output, "client"), buildId, digest)
    : null;
  const after = await readReleaseBuildSource(input.directory);
  const afterConfig = await readFile(configPath);
  if (
    JSON.stringify(source) !== JSON.stringify(after) ||
    !afterConfig.equals(buildConfig) ||
    (!web && (await readFile(entryPath, "utf-8")) !== entrySource)
  ) {
    throw new Error(
      "Release source or build configuration changed during compilation."
    );
  }
  const manifest = releaseArtifactSchema.parse({ archive, artifact, digest });
  await verifyReleaseSourceMaps(manifest, input.output);
  await rm(configPath);
  if (!web) {
    await rm(entryPath);
    if (
      path.dirname(path.resolve(builtDirectory)) !== path.resolve(input.output)
    ) {
      throw new Error(
        "Temporary build output escaped the new artifact directory."
      );
    }
    await rm(builtDirectory, { recursive: true });
  }
  await writeFile(
    path.join(input.output, "artifact.json"),
    JSON.stringify(manifest, null, 2),
    { flag: "wx" }
  );
  return manifest;
};
