import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const serverDirectory = path.resolve(
  import.meta.dirname,
  "../.cloudflare/output/v0/workers/default/bundle"
);
const marker = "src/features/home/components/home-page.tsx";
const files = await readdir(serverDirectory, { recursive: true });
let found = false;
for (const file of files) {
  if (!file.endsWith(".js")) {
    continue;
  }
  const source = await readFile(path.join(serverDirectory, file), "utf-8");
  if (source.includes(marker)) {
    found = true;
    break;
  }
}
if (!found) {
  throw new Error("The site worker bundle is missing the landing page.");
}
process.stdout.write("Site worker includes the landing page.\n");
