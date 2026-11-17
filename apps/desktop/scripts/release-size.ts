import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import type { SizeEntry, SizeReport } from "./release-report.ts";

const platformTargets = new Map<
  NodeJS.Platform,
  { extensions: string[]; unpacked: RegExp }
>([
  [
    "darwin",
    { extensions: [".dmg", ".zip"], unpacked: /^mac(?:-[a-z0-9]+)?$/u },
  ],
  [
    "linux",
    {
      extensions: [".AppImage", ".deb"],
      unpacked: /^linux(?:-[a-z0-9]+)?-unpacked$/u,
    },
  ],
  [
    "win32",
    { extensions: [".exe"], unpacked: /^win(?:-[a-z0-9]+)?-unpacked$/u },
  ],
]);

const measureDirectory = (
  directory: string
): {
  files: number;
  regularFileBytes: number;
  symlinksSkipped: number;
} => {
  let regularFileBytes = 0;
  let files = 0;
  let symlinksSkipped = 0;
  for (const name of readdirSync(directory).toSorted()) {
    const entryPath = path.join(directory, name);
    const entry = lstatSync(entryPath);
    if (entry.isSymbolicLink()) {
      symlinksSkipped += 1;
    } else if (entry.isFile()) {
      regularFileBytes += entry.size;
      files += 1;
    } else if (entry.isDirectory()) {
      const nested = measureDirectory(entryPath);
      regularFileBytes += nested.regularFileBytes;
      files += nested.files;
      symlinksSkipped += nested.symlinksSkipped;
    } else {
      throw new Error(
        "Unpacked application contains a special filesystem entry."
      );
    }
  }
  return { files, regularFileBytes, symlinksSkipped };
};

const hashInstaller = (filename: string) => {
  const descriptor = openSync(filename, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(64 * 1024);
  let bytes = 0;
  try {
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.byteLength, null);
      if (count === 0) {
        break;
      }
      bytes += count;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    closeSync(descriptor);
  }
  return { bytes, sha256: hash.digest("hex") };
};

const main = (): void => {
  const { values } = parseArgs({
    options: {
      directory: { type: "string" },
      "github-output": { type: "string" },
      help: { type: "boolean" },
      revision: { type: "string" },
    },
  });
  if (values.help === true) {
    process.stdout.write(
      "Usage: vp run @quieter/desktop#release:size --revision <full-SHA> [--directory <release-directory>] [--github-output <output-file>]\n"
    );
    return;
  }
  if (
    values.revision === undefined ||
    !/^[a-f0-9]{40}$/u.test(values.revision)
  ) {
    throw new Error("A full lowercase source SHA is required with --revision.");
  }
  const repository = path.resolve(import.meta.dirname, "../../..");
  const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf-8",
  }).trim();
  if (sourceRevision !== values.revision) {
    throw new Error("The expected source SHA does not match this checkout.");
  }
  const sourceDirty =
    execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
      cwd: repository,
      encoding: "utf-8",
    }).trim() !== "";
  const manifest: unknown = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf-8")
  );
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    !("version" in manifest) ||
    typeof manifest.version !== "string"
  ) {
    throw new Error("The desktop package version is missing.");
  }
  const targets = platformTargets.get(process.platform);
  if (!targets) {
    throw new Error(
      "This platform has no configured desktop distribution targets."
    );
  }
  const directory = path.resolve(
    values.directory ?? path.join(import.meta.dirname, "../release")
  );
  if (/[\r\n]/u.test(directory) || !lstatSync(directory).isDirectory()) {
    throw new Error(
      "The release path must be a real directory without newlines."
    );
  }
  const reportPath = path.join(directory, "release-size.json");
  rmSync(reportPath, { force: true });
  const entries: SizeEntry[] = [];
  const artifacts: string[] = [];
  const measuredExtensions = new Set<string>();
  for (const name of readdirSync(directory).toSorted()) {
    if (/[\r\n]/u.test(name)) {
      throw new Error("Release output names must not contain newlines.");
    }
    const filename = path.join(directory, name);
    const extension = targets.extensions.find((suffix) =>
      name.endsWith(suffix)
    );
    if (extension !== undefined) {
      const entry = lstatSync(filename);
      if (!entry.isFile() || entry.size === 0) {
        throw new Error(
          "Every distribution target must be a nonempty regular file."
        );
      }
      entries.push({
        kind: "distribution",
        path: name,
        ...hashInstaller(filename),
      });
      measuredExtensions.add(extension);
      artifacts.push(filename);
    } else if (targets.unpacked.test(name)) {
      if (!lstatSync(filename).isDirectory()) {
        throw new Error(
          "An unpacked application path must be a real directory."
        );
      }
      const appDirectory =
        process.platform === "darwin"
          ? path.join(filename, "quieter.app")
          : filename;
      if (!lstatSync(appDirectory).isDirectory()) {
        throw new Error(
          "An unpacked application must contain a real app directory."
        );
      }
      const size = measureDirectory(appDirectory);
      if (size.regularFileBytes === 0) {
        throw new Error("The unpacked application contains no file data.");
      }
      entries.push({
        kind: "unpacked-app",
        path: path.relative(directory, appDirectory).split(path.sep).join("/"),
        ...size,
      });
    }
  }
  if (
    targets.extensions.some((extension) => !measuredExtensions.has(extension))
  ) {
    throw new Error(
      "The release directory is missing a configured installer target."
    );
  }
  if (!entries.some((entry) => entry.kind === "unpacked-app")) {
    throw new Error(
      "The release directory is missing its unpacked application."
    );
  }
  const report: SizeReport = {
    entries,
    hostArchitecture: process.arch,
    packageVersion: manifest.version,
    platform: process.platform,
    schemaVersion: 1,
    sourceDirty,
    sourceRevision,
  };
  const temporaryReport = path.join(
    directory,
    `release-size-${randomUUID()}.tmp`
  );
  writeFileSync(temporaryReport, `${JSON.stringify(report, null, 2)}\n`, {
    flag: "wx",
  });
  renameSync(temporaryReport, reportPath);
  if (values["github-output"] !== undefined) {
    const delimiter = randomUUID();
    appendFileSync(
      values["github-output"],
      `artifact_paths<<${delimiter}\n${[...artifacts, reportPath].join("\n")}\n${delimiter}\n`
    );
  }
  process.stdout.write(`${reportPath}\n`);
};

main();
