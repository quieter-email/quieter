import { glob, readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { findImportBoundaryViolations } from "./import-boundaries.ts";

const root = path.resolve(import.meta.dirname, "..");
const manifestSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  name: z.string(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
});
const appManifests = await Array.fromAsync(
  glob("apps/*/package.json", { cwd: root })
);
const applicationPackages = new Set(
  await Promise.all(
    appManifests.map(
      async (file) =>
        manifestSchema.parse(
          JSON.parse(await readFile(path.join(root, file), "utf-8"))
        ).name
    )
  )
);
const files = await Array.fromAsync(
  glob(
    [
      "apps/*/src/**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
      "packages/*/src/**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
      "packages/*/package.json",
    ],
    { cwd: root, exclude: ["**/routeTree.gen.ts", "**/sst-env.d.ts"] }
  )
);
const results = await Promise.all(
  files.map(async (file) => {
    const source = await readFile(path.join(root, file), "utf-8");
    if (!file.endsWith("package.json")) {
      return findImportBoundaryViolations(file, source, applicationPackages);
    }
    const manifest = manifestSchema.parse(JSON.parse(source));
    return Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    })
      .filter((name) => applicationPackages.has(name))
      .map(
        (name) =>
          `${file}: Package dependency on application ${name} is forbidden.`
      );
  })
);
const violations = results.flat();
if (violations.length > 0) {
  throw new Error(`Import boundaries failed:\n${violations.join("\n")}`);
}
process.stdout.write(
  `Import boundaries passed for ${files.length} source files and manifests.\n`
);
