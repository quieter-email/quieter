import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Uploads the assets this deploy just built to the R2 archive the Worker falls
 * back to. A release replaces the Worker asset manifest wholesale, so without
 * this the previous build's hashed chunks become unreachable and tabs opened
 * before the deploy break on their next lazy import.
 *
 * Runs after `sst deploy`, which is when the built assets and the stack
 * outputs both exist. Nothing is ever deleted here: the archive is precisely
 * what older tabs are still reading from.
 */
const projectRoot = path.resolve(import.meta.dirname, "..");
const assetsDirectory = path.join(
  projectRoot,
  "apps",
  "web",
  "dist",
  "client",
  "assets"
);
const wranglerEntry = path.join(
  projectRoot,
  "apps",
  "web",
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js"
);
const outputsPath = path.join(projectRoot, ".sst", "outputs.json");
const buildIdPath = path.join(assetsDirectory, "build-id.txt");

/** Served straight back to the browser, which rejects a module without one. */
const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

const uploadConcurrency = 8;

const runWrangler = async (args: string[], target: string) => {
  const child = spawn(process.execPath, [wranglerEntry, ...args], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });

  // oxlint-disable-next-line promise/avoid-new -- bridging spawn's callback API is exactly what a Promise constructor is for.
  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Archiving ${target} failed with exit code ${code}.`));
    });
  });
};

const outputs: unknown = JSON.parse(await fs.readFile(outputsPath, "utf-8"));
const bucket =
  typeof outputs === "object" &&
  outputs !== null &&
  "webAssetArchiveBucket" in outputs
    ? outputs.webAssetArchiveBucket
    : null;
if (typeof bucket !== "string" || bucket === "") {
  throw new Error(
    `Expected "webAssetArchiveBucket" in ${outputsPath}. Deploy the stack before archiving assets.`
  );
}

const fileNames = await fs.readdir(assetsDirectory);
const uploads = fileNames.map((fileName) => ({
  contentType: contentTypes[path.extname(fileName)],
  fileName,
}));
const unknownTypes = uploads.filter(
  ({ contentType }) => contentType === undefined
);
if (unknownTypes.length > 0) {
  // Archiving a file without a usable content type would reproduce the exact
  // failure this prevents, so fail the deploy instead.
  throw new Error(
    `No content type for ${unknownTypes.map(({ fileName }) => fileName).join(", ")}. Add the extension to contentTypes.`
  );
}

const buildIdFile = await fs.readFile(buildIdPath, "utf-8");
const buildId = buildIdFile.trim();
if (!/^[\w.-]{1,128}$/u.test(buildId)) {
  throw new Error(
    "The web build id is empty or contains unsupported characters."
  );
}
const releaseMarker = `${bucket}/assets/releases/${buildId}.txt`;

// A same-build workflow rerun is the recovery path after a partial upload.
// Remove any prior marker first so it cannot certify this attempt prematurely.
await runWrangler(
  ["r2", "object", "delete", releaseMarker, "--remote"],
  `previous release marker ${buildId}`
);

const queue = [...uploads];
const uploadNext = async () => {
  let upload = queue.pop();
  while (upload !== undefined) {
    // oxlint-disable-next-line no-await-in-loop -- sequential by design: this is one of a fixed number of workers draining a shared queue.
    await runWrangler(
      [
        "r2",
        "object",
        "put",
        `${bucket}/assets/${upload.fileName}`,
        "--file",
        path.join(assetsDirectory, upload.fileName),
        "--content-type",
        upload.contentType,
        "--remote",
      ],
      upload.fileName
    );
    upload = queue.pop();
  }
};

await Promise.all(
  Array.from(
    { length: Math.min(uploadConcurrency, uploads.length) },
    async () => {
      await uploadNext();
    }
  )
);

await runWrangler(
  [
    "r2",
    "object",
    "put",
    releaseMarker,
    "--file",
    buildIdPath,
    "--content-type",
    "text/plain; charset=utf-8",
    "--remote",
  ],
  `release marker ${buildId}`
);

process.stdout.write(`Archived ${uploads.length} web assets to ${bucket}.\n`);
