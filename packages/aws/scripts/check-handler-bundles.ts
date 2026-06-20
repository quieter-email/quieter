import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const outputDirectory = join(packageRoot, ".bundle-check");
const entrypoints = [
  "chat-generation-enqueue.ts",
  "chat-generation-starter.ts",
  "chat-generation-workflow.ts",
  "gmail-live-sync-websocket.ts",
  "gmail-pubsub-consumer.ts",
  "gmail-pubsub-ingress.ts",
  "gmail-pubsub-maintenance.ts",
  "inbound.ts",
  "receipt.ts",
].map((fileName) => join(packageRoot, "src", fileName));

await rm(outputDirectory, { force: true, recursive: true });
try {
  const result = await Bun.build({
    entrypoints,
    external: ["sst"],
    minify: false,
    outdir: outputDirectory,
    sourcemap: "none",
    target: "node",
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("Handler bundle check failed.");
  }
} finally {
  await rm(outputDirectory, { force: true, recursive: true });
}

console.log(`Bundled ${entrypoints.length} AWS handlers successfully.`);
