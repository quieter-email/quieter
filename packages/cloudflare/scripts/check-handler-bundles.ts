import { rm } from "node:fs/promises";
import path from "node:path";

import { rolldown } from "rolldown";

const packageRoot = path.resolve(import.meta.dirname, "..");
const outputDirectory = path.join(packageRoot, ".bundle-check");
const entrypoints = [path.join(packageRoot, "src", "worker.ts")];

await rm(outputDirectory, { force: true, recursive: true });
try {
  const bundle = await rolldown({
    external: ["cloudflare:workers", "sst", "sst/resource"],
    input: entrypoints,
    // Workers use nodejs_compat; match the AWS handler check target so Node builtins resolve.
    platform: "node",
  });
  try {
    await bundle.write({
      dir: outputDirectory,
      format: "esm",
      sourcemap: false,
    });
  } finally {
    await bundle.close();
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  await rm(outputDirectory, { force: true, recursive: true });
  throw new Error("Cloudflare worker bundle check failed.", { cause: error });
}
await rm(outputDirectory, { force: true, recursive: true });

process.stdout.write(
  `Bundled ${entrypoints.length} Cloudflare workers successfully.\n`
);
