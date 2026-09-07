/* oxlint-disable eslint/no-await-in-loop -- Hash files sequentially to bound memory during large builds. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

// SST invokes this bootstrap from apps/web with its resolved production bindings.
const [mode] = process.argv.slice(2);
const configPath = process.env.SST_WRANGLER_PATH;
const buildId = process.env.QUIETER_BUILD_ID;
if (
  configPath === undefined ||
  configPath === "" ||
  buildId === undefined ||
  buildId === ""
) {
  throw new Error(
    "Prepare production releases through the deployment workflow."
  );
}
const receiptPath = path.resolve("../../.sst/prepared-web.json");
const configuration = createHash("sha256")
  .update(await readFile(configPath))
  .update(buildId)
  .digest("hex");

if (mode === "diff" || mode === "refresh") {
  if (
    (process.env.SENTRY_AUTH_TOKEN ?? "") === "" ||
    (process.env.SENTRY_ORG ?? "") === "" ||
    (process.env.SENTRY_PROJECT ?? "") === ""
  ) {
    throw new Error(
      "Production preparation requires the Sentry source-map upload configuration."
    );
  }
  execFileSync("vp", ["run", "build"], {
    shell: process.platform === "win32",
    stdio: "inherit",
  });
} else if (mode !== "deploy") {
  throw new Error(`Unsupported production build operation: ${mode}`);
}

const files: Record<string, string> = {};
const entries = await readdir("dist", { recursive: true, withFileTypes: true });
for (const entry of entries.toSorted((left, right) =>
  path
    .join(left.parentPath, left.name)
    .localeCompare(path.join(right.parentPath, right.name))
)) {
  if (entry.isSymbolicLink()) {
    throw new Error("Prepared builds must not contain symlinks.");
  }
  if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name);
    files[path.relative("dist", file).replaceAll("\\", "/")] = createHash(
      "sha256"
    )
      .update(await readFile(file))
      .digest("hex");
  }
}
const markerText = await readFile("dist/client/assets/build-id.txt", "utf-8");
if (
  !files["server/wrangler.json"] ||
  !files["client/assets/build-id.txt"] ||
  markerText.trim() !== buildId
) {
  throw new Error(
    "Prepared build is incomplete or belongs to another release."
  );
}
const receipt = JSON.stringify({ buildId, configuration, files });
if (mode === "deploy") {
  if ((await readFile(receiptPath, "utf-8")) !== receipt) {
    throw new Error(
      "Build output or SST configuration changed after preparation. Run preparation again."
    );
  }
  process.stdout.write("Verified prepared web build; skipping rebuild.\n");
} else {
  await writeFile(receiptPath, receipt);
}
