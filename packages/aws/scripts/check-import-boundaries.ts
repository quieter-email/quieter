/// <reference types="bun-types" />
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const sourceRoot = path.join(import.meta.dirname, "..", "src");
const allowedOrpcImports = new Set([
  "@quieter/orpc/gmail-live-sync",
  "@quieter/orpc/gmail-live-sync-token",
  "@quieter/orpc/gmail-pubsub",
  "@quieter/orpc/mailbox-actions",
  "@quieter/orpc/managed-mail/ingestion",
]);

const listTypeScriptFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return await listTypeScriptFiles(entryPath);
      }
      return entry.name.endsWith(".ts") ? [entryPath] : [];
    })
  );
  return nestedFiles.flat();
};

const violations: string[] = [];
const sourceFiles = await listTypeScriptFiles(sourceRoot);
await Promise.all(
  sourceFiles.map(async (filePath) => {
    const source = await readFile(filePath, "utf-8");
    for (const match of source.matchAll(
      /from\s+["'](?<specifier>@quieter\/orpc[^"']*)["']/gu
    )) {
      const { specifier } = match.groups ?? {};
      if (
        specifier !== undefined &&
        specifier.length > 0 &&
        !allowedOrpcImports.has(specifier)
      ) {
        violations.push(
          `${path.relative(sourceRoot, filePath)} imports ${specifier}`
        );
      }
    }
  })
);

if (violations.length > 0) {
  process.stderr.write(
    "AWS handlers may only import deployment-safe oRPC entrypoints:\n"
  );
  for (const violation of violations) {
    process.stderr.write(`- ${violation}\n`);
  }
  throw new Error("AWS handler import boundaries are invalid.");
}

process.stdout.write("AWS handler import boundaries are valid.\n");
