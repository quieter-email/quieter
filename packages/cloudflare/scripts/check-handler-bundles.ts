import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const outputDirectory = join(packageRoot, ".bundle-check");
const entrypoints = ["worker.ts", "chat-generation-worker.ts"].map((fileName) =>
  join(packageRoot, "src", fileName),
);

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
    for (const log of result.logs) console.error(log);
    throw new Error("Cloudflare worker bundle check failed.");
  }
} finally {
  await rm(outputDirectory, { force: true, recursive: true });
}

console.log(`Bundled ${entrypoints.length} Cloudflare workers successfully.`);
