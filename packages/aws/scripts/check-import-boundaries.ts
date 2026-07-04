import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const sourceRoot = join(import.meta.dir, "..", "src");
const allowedOrpcImports = new Set([
  "@quieter/orpc/chat-generation",
  "@quieter/orpc/gmail-live-sync",
  "@quieter/orpc/gmail-live-sync-token",
  "@quieter/orpc/gmail-pubsub",
  "@quieter/orpc/mailbox-actions",
  "@quieter/orpc/managed-mail/ingestion",
]);

const listTypeScriptFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory()
          ? listTypeScriptFiles(path)
          : Promise.resolve(entry.name.endsWith(".ts") ? [path] : []);
      }),
    )
  ).flat();
};

const violations: string[] = [];
for (const path of await listTypeScriptFiles(sourceRoot)) {
  const source = await readFile(path, "utf8");
  for (const match of source.matchAll(/from\s+["'](@quieter\/orpc[^"']*)["']/g)) {
    const specifier = match[1];
    if (!allowedOrpcImports.has(specifier)) {
      violations.push(`${relative(sourceRoot, path)} imports ${specifier}`);
    }
  }
}

if (violations.length > 0) {
  console.error("AWS handlers may only import deployment-safe oRPC entrypoints:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("AWS handler import boundaries are valid.");
