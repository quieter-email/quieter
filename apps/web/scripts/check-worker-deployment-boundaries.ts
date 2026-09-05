import { execFileSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const serverDirectory = path.resolve(import.meta.dirname, "../dist/server");
const assetDirectory = path.join(serverDirectory, "assets");
const serverFiles = await readdir(serverDirectory);
const assetFiles = await readdir(assetDirectory);
const cloudflareBundle = serverFiles.includes("wrangler.json");
const maximumChunkBytes = cloudflareBundle ? 1_800_000 : 800_000;
const maximumCompressedWorkerBytes = 10_000_000;
const boundaries: {
  forbiddenMarkers?: string[];
  marker: string;
  maximumStaticGraphBytes: number;
}[] = [
  {
    marker: "src/features/home/components/home-page.tsx",
    maximumStaticGraphBytes: cloudflareBundle ? 1_200_000 : 1_000_000,
  },
  {
    forbiddenMarkers: [
      "src/features/settings/components/settings-layout.tsx",
      "src/features/settings/components/settings-overview-panel.tsx",
      "src/components/workspace-dither-background.tsx",
    ],
    marker: "src/router.tsx",
    maximumStaticGraphBytes: cloudflareBundle ? 3_000_000 : 1_200_000,
  },
  {
    marker: "packages/auth/src/session.ts",
    maximumStaticGraphBytes: cloudflareBundle ? 2_700_000 : 1_700_000,
  },
  {
    marker: "packages/auth/src/index.ts",
    maximumStaticGraphBytes: cloudflareBundle ? 3_700_000 : 1_900_000,
  },
  {
    marker: "packages/orpc/src/routers/mail.ts",
    maximumStaticGraphBytes: cloudflareBundle ? 3_200_000 : 2_500_000,
  },
];

const files = [
  ...serverFiles
    .filter((file) => file.endsWith(".js"))
    .map((file) => path.join(serverDirectory, file)),
  ...assetFiles
    .filter((file) => file.endsWith(".js"))
    .map((file) => path.join(assetDirectory, file)),
];
const sources = new Map<string, string>(
  await Promise.all(
    files.map(async (file) => [file, await readFile(file, "utf-8")] as const)
  )
);

for (const {
  forbiddenMarkers = [],
  marker,
  maximumStaticGraphBytes,
} of boundaries) {
  const entry = [...sources].find(([, source]) => source.includes(marker))?.[0];
  if (entry === undefined) {
    throw new Error(
      `Could not find the Worker static boundary entry for ${marker}.`
    );
  }

  const reachable = new Set<string>();
  const visit = (file: string) => {
    if (reachable.has(file)) {
      return;
    }
    reachable.add(file);

    const source = sources.get(file);
    if (source === undefined) {
      return;
    }

    for (const match of source.matchAll(
      /^import\s*(?:.+?\sfrom\s*)?["'](?<specifier>.+?)["'];/gmu
    )) {
      const specifier = match.groups?.specifier;
      if (
        specifier === undefined ||
        specifier === "" ||
        !specifier.startsWith(".")
      ) {
        continue;
      }

      const dependency = path.resolve(path.dirname(file), specifier);
      if (sources.has(dependency)) {
        visit(dependency);
      }
    }
  };
  visit(entry);

  for (const forbiddenMarker of forbiddenMarkers) {
    const dependency = [...reachable].find(
      (file) => sources.get(file)?.includes(forbiddenMarker) === true
    );
    if (dependency !== undefined) {
      throw new Error(
        `${marker} eagerly loads forbidden module ${forbiddenMarker} through ${dependency}.`
      );
    }
  }

  const sizes = await Promise.all(
    [...reachable].map(async (file) => {
      const fileStats = await stat(file);
      return { bytes: fileStats.size, file };
    })
  );
  const [firstSize] = sizes;
  let largest = firstSize;
  let totalBytes = 0;
  for (const size of sizes) {
    totalBytes += size.bytes;
    if (largest === undefined || size.bytes > largest.bytes) {
      largest = size;
    }
  }

  if (largest === undefined) {
    throw new Error("Could not measure the Worker bundle.");
  }

  if (
    largest.bytes > maximumChunkBytes ||
    totalBytes > maximumStaticGraphBytes
  ) {
    throw new Error(
      `${marker} eagerly loads ${(totalBytes / 1_000_000).toFixed(2)} MB; largest chunk is ${(
        largest.bytes / 1_000_000
      ).toFixed(2)} MB (${largest.file}).`
    );
  }

  process.stdout.write(
    `${marker}: ${(totalBytes / 1_000_000).toFixed(2)} MB static graph, ${(
      largest.bytes / 1_000_000
    ).toFixed(2)} MB largest chunk\n`
  );
}

if (cloudflareBundle) {
  const wranglerBin = path.resolve(
    import.meta.dirname,
    "../node_modules/wrangler/bin/wrangler.js"
  );
  const output = execFileSync(
    process.execPath,
    [wranglerBin, "deploy", "--dry-run", "--config", "wrangler.json"],
    {
      cwd: serverDirectory,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const uploadMatch =
    /Total Upload:\s*[\d.]+\s*(?:KiB|MiB)\s*\/\s*gzip:\s*(?<size>[\d.]+)\s*(?<unit>KiB|MiB)/u.exec(
      output
    );
  const compressedSize = Number(uploadMatch?.groups?.size);
  const compressedUnit = uploadMatch?.groups?.unit;
  if (
    !Number.isFinite(compressedSize) ||
    (compressedUnit !== "KiB" && compressedUnit !== "MiB")
  ) {
    throw new Error("Could not read the compressed Worker size from Wrangler.");
  }
  const compressedBytes =
    compressedSize * (compressedUnit === "MiB" ? 1024 * 1024 : 1024);
  if (compressedBytes >= maximumCompressedWorkerBytes) {
    throw new Error(
      `The compressed Worker upload is ${(compressedBytes / 1_000_000).toFixed(2)} MB; the limit is ${(maximumCompressedWorkerBytes / 1_000_000).toFixed(0)} MB.`
    );
  }
  process.stdout.write(
    `Worker upload: ${(compressedBytes / 1_000_000).toFixed(2)} MB compressed (${(
      (compressedBytes / maximumCompressedWorkerBytes) *
      100
    ).toFixed(1)}% of limit)\n`
  );
}
