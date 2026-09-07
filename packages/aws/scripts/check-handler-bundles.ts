import { rm } from "node:fs/promises";
import path from "node:path";

import { rolldown } from "rolldown";

const packageRoot = path.resolve(import.meta.dirname, "..");
const outputDirectory = path.join(packageRoot, ".bundle-check");
const entrypoints = ["inbound.ts", "outbound-feedback.ts", "receipt.ts"].map(
  (fileName) => path.join(packageRoot, "src", fileName)
);

await rm(outputDirectory, { force: true, recursive: true });
try {
  const bundle = await rolldown({
    external: ["sst"],
    input: entrypoints,
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
  throw new Error("Handler bundle check failed.", { cause: error });
}
await rm(outputDirectory, { force: true, recursive: true });

process.stdout.write(
  `Bundled ${entrypoints.length} AWS handlers successfully.\n`
);
