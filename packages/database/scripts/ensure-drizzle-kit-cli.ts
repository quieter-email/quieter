// Restores drizzle-kit/cli when npm omits the SDK bundle. See AGENTS.md (Schema +
// Generated Files → upgrading drizzle-kit) and vendor/drizzle-kit-cli/README.md.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const vendorDirectory = join(packageDirectory, "vendor", "drizzle-kit-cli");

const require = createRequire(import.meta.url);

const cliExport = {
  import: {
    types: "./cli.d.mts",
    default: "./cli.mjs",
  },
  require: {
    types: "./cli.d.ts",
    default: "./cli.js",
  },
  types: "./cli.d.mts",
  default: "./cli.mjs",
} as const;

export const ensureDrizzleKitCli = () => {
  try {
    require.resolve("drizzle-kit/cli");
    return;
  } catch {
    // Published rc.4 tarballs omit the programmatic CLI bundle.
  }

  const drizzleKitPackageDirectory = dirname(require.resolve("drizzle-kit/package.json"));
  const cliModulePath = join(drizzleKitPackageDirectory, "cli.mjs");
  const cliTypesPath = join(drizzleKitPackageDirectory, "cli.d.mts");
  const packageJsonPath = join(drizzleKitPackageDirectory, "package.json");

  writeFileSync(cliModulePath, gunzipSync(readFileSync(join(vendorDirectory, "cli.mjs.gz"))));
  writeFileSync(cliTypesPath, readFileSync(join(vendorDirectory, "cli.d.mts"), "utf8"));

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    exports?: Record<string, unknown>;
  };

  packageJson.exports = {
    ...packageJson.exports,
    "./cli": cliExport,
  };
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
};

if (import.meta.main) {
  ensureDrizzleKitCli();
}
