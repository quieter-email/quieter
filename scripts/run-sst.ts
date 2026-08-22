import { spawn } from "node:child_process";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const sstEntryPath = path.join(
  projectRoot,
  "node_modules",
  "sst",
  "bin",
  "sst.mjs"
);

const child = spawn(
  process.execPath,
  [sstEntryPath, ...process.argv.slice(2)],
  { cwd: projectRoot, env: process.env, stdio: "inherit" }
);
child.on("error", (error) => {
  throw error;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
