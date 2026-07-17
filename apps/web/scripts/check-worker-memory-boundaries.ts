import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const serverDirectory = resolve(import.meta.dirname, "../dist/server");
const assetDirectory = join(serverDirectory, "assets");
const maximumChunkBytes = 800_000;
const boundaries = [
  { marker: "src/features/home/components/home-page.tsx", maximumStaticGraphBytes: 1_000_000 },
  { marker: "src/router.tsx", maximumStaticGraphBytes: 1_200_000 },
  { marker: "packages/auth/src/session.ts", maximumStaticGraphBytes: 1_500_000 },
  { marker: "packages/auth/src/index.ts", maximumStaticGraphBytes: 1_600_000 },
  { marker: "packages/orpc/src/routers/mail.ts", maximumStaticGraphBytes: 2_500_000 },
];

const files = [
  ...(await readdir(serverDirectory))
    .filter((file) => file.endsWith(".js"))
    .map((file) => join(serverDirectory, file)),
  ...(await readdir(assetDirectory))
    .filter((file) => file.endsWith(".js"))
    .map((file) => join(assetDirectory, file)),
];
const sources = new Map<string, string>(
  await Promise.all(files.map(async (file) => [file, await readFile(file, "utf8")] as const)),
);

for (const { marker, maximumStaticGraphBytes } of boundaries) {
  const entry = [...sources].find(([, source]) => source.includes(marker))?.[0];
  if (!entry) throw new Error(`Could not find the Worker memory boundary entry for ${marker}.`);

  const reachable = new Set<string>();
  const visit = (file: string) => {
    if (reachable.has(file)) return;
    reachable.add(file);

    const source = sources.get(file);
    if (!source) return;

    for (const match of source.matchAll(/^import\s*(?:.+?\sfrom\s*)?["'](.+?)["'];/gm)) {
      const specifier = match[1];
      if (!specifier?.startsWith(".")) continue;

      const dependency = resolve(dirname(file), specifier);
      if (sources.has(dependency)) visit(dependency);
    }
  };
  visit(entry);

  const sizes = await Promise.all(
    [...reachable].map(async (file) => ({ bytes: (await stat(file)).size, file })),
  );
  const largest = sizes.reduce((current, candidate) =>
    candidate.bytes > current.bytes ? candidate : current,
  );
  const totalBytes = sizes.reduce((total, file) => total + file.bytes, 0);

  if (largest.bytes > maximumChunkBytes || totalBytes > maximumStaticGraphBytes) {
    throw new Error(
      `${marker} eagerly loads ${(totalBytes / 1_000_000).toFixed(2)} MB; largest chunk is ${(
        largest.bytes / 1_000_000
      ).toFixed(2)} MB (${largest.file}).`,
    );
  }

  console.log(
    `${marker}: ${(totalBytes / 1_000_000).toFixed(2)} MB static graph, ${(
      largest.bytes / 1_000_000
    ).toFixed(2)} MB largest chunk`,
  );
}
