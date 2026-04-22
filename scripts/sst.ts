import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const passThroughCommands = new Set(["--help", "-h", "help", "version", "upgrade", "telemetry"]);

const hasOption = (name: string) => args.some((arg) => arg === name || arg.startsWith(`${name}=`));
const shouldUseAppDefaults = args.length > 0 && !passThroughCommands.has(args[0] ?? "");

const sstArgs = [...args];

if (shouldUseAppDefaults && !hasOption("--config")) {
  sstArgs.push("--config", "sst.config.ts");
}

if (shouldUseAppDefaults && !hasOption("--stage")) {
  sstArgs.push("--stage", "mail-dev");
}

const result = spawnSync("bunx", ["sst", ...sstArgs], {
  cwd: repoRoot,
  env: process.env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

process.exit(result.status ?? 1);
