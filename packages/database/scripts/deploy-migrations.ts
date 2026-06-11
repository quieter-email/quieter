import { fileURLToPath } from "node:url";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));

for (const script of ["scripts/prepare-production.ts", "scripts/run-migrations.ts"]) {
  const process = Bun.spawn(["bun", script], {
    cwd: packageDirectory,
    env: globalThis.process.env,
    stderr: "inherit",
    stdout: "inherit",
  });

  const exitCode = await process.exited;
  if (exitCode !== 0) {
    globalThis.process.exit(exitCode);
  }
}
