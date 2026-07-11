import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const ignoredSegments = new Set([
  ".agents",
  ".git",
  ".scratch",
  ".sst",
  "build",
  "dist",
  "node_modules",
]);
const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".mts",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const forbiddenValues = [
  String.fromCodePoint(183),
  `&${"middot;"}`,
  `&#${"183;"}`,
  `&#${"xB7;"}`,
  `\\${"u00B7"}`,
  `\\${"xB7"}`,
];
const violations: string[] = [];

const walk = async (directory: string): Promise<void> => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignoredSegments.has(entry.name)) {
      continue;
    }

    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }

    if (!textExtensions.has(extname(entry.name))) {
      continue;
    }

    const relativePath = path.slice(repoRoot.length + 1).replaceAll("\\", "/");
    const text = await readFile(path, "utf8");
    if (
      forbiddenValues.some((value) => text.toLocaleLowerCase().includes(value.toLocaleLowerCase()))
    ) {
      violations.push(relativePath);
    }
  }
};

await walk(repoRoot);

if (violations.length > 0) {
  console.error(`Middle-dot separators are not allowed:\n${violations.join("\n")}`);
  process.exit(1);
}

console.log("No middle-dot separators found.");
