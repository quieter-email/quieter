/// <reference types="bun-types" />
import { rm } from "node:fs/promises";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dirname, "..");
const outputDirectory = path.join(packageRoot, ".bundle-check");
const entrypoints = [path.join(packageRoot, "src", "worker.ts")];

const formatBuildLog = (log: unknown): string => {
  if (typeof log === "string") {
    return log;
  }
  if (log instanceof Error) {
    return log.message;
  }
  if (typeof log === "object" && log !== null && "message" in log) {
    const { message } = log;
    if (typeof message === "string") {
      return message;
    }
  }
  return JSON.stringify(log) ?? "Unknown build error.";
};

await rm(outputDirectory, { force: true, recursive: true });
try {
  const result = await Bun.build({
    entrypoints,
    external: ["cloudflare:workers", "sst", "sst/resource"],
    minify: false,
    outdir: outputDirectory,
    sourcemap: "none",
    // Workers use nodejs_compat; match the AWS handler check target so Node builtins resolve.
    target: "node",
  });

  if (!result.success) {
    for (const log of result.logs) {
      process.stderr.write(`${formatBuildLog(log)}\n`);
    }
    throw new Error("Cloudflare worker bundle check failed.");
  }
} finally {
  await rm(outputDirectory, { force: true, recursive: true });
}

process.stdout.write(
  `Bundled ${entrypoints.length} Cloudflare workers successfully.\n`
);
