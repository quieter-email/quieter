import { fileURLToPath } from "node:url";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));

const process = Bun.spawn(["bun", "scripts/run-migrations.ts"], {
  cwd: packageDirectory,
  env: globalThis.process.env,
  stderr: "inherit",
  stdout: "inherit",
});

const exitCode = await process.exited;
if (exitCode !== 0) {
  globalThis.process.exit(exitCode);
}
