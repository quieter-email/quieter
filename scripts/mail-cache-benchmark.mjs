import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createServer } from "vite";

const workspace = path.resolve(import.meta.dirname, "..");
const baseline = execFileSync(
  "git",
  ["show", "85b9d05d:packages/app/src/lib/mail-cache.ts"],
  { cwd: workspace, encoding: "utf-8" }
);
const temporary = await mkdtemp(
  path.resolve(tmpdir(), "quieter-cache-benchmark-")
);
await writeFile(path.resolve(temporary, "before.ts"), baseline);
await writeFile(
  path.resolve(temporary, "index.html"),
  await readFile(path.resolve(import.meta.dirname, "mail-cache-benchmark.html"))
);
const server = await createServer({
  configFile: false,
  resolve: {
    alias: {
      "benchmark-current": path.resolve(
        workspace,
        "packages/app/src/lib/mail-cache.ts"
      ),
      idb: path.resolve(
        workspace,
        "packages/app/node_modules/idb/build/index.js"
      ),
      zod: path.resolve(workspace, "packages/app/node_modules/zod/index.js"),
    },
  },
  root: temporary,
  server: { fs: { allow: [temporary, workspace] }, host: "127.0.0.1", port: 0 },
});
await server.listen();
server.printUrls();
process.stdout.write(
  "Open this isolated origin and run await runMailCacheBenchmark() in its browser console. Ctrl-C stops this server.\n"
);
await Promise.race([once(process, "SIGINT"), once(process, "SIGTERM")]);
await server.close();
await rm(temporary, { force: true, recursive: true });
