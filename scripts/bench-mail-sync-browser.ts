import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
} from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";

const session = `mail-sync-benchmark-${Date.now()}`;
const executable =
  process.platform === "win32" ? "agent-browser.exe" : "agent-browser";
const run = (args: string[], input?: string) => {
  const directory = mkdtempSync(
    path.resolve(tmpdir(), "quieter-sync-benchmark-")
  );
  const outputPath = path.resolve(directory, "output.txt");
  const errorPath = path.resolve(directory, "error.txt");
  const output = openSync(outputPath, "w");
  const errors = openSync(errorPath, "w");
  try {
    // Browser daemon startup can inherit pipes; files let the CLI exit independently.
    const result = spawnSync(executable, ["--session", session, ...args], {
      encoding: "utf-8",
      input,
      stdio: ["pipe", output, errors],
      timeout: 60_000,
      windowsHide: true,
    });
    if (result.error !== undefined || result.status !== 0) {
      throw new Error(
        result.error?.message ||
          readFileSync(errorPath, "utf-8") ||
          "Browser verification failed. Install agent-browser and run vp run dev:full first."
      );
    }
    return readFileSync(outputPath, "utf-8").trim();
  } finally {
    closeSync(output);
    closeSync(errors);
    unlinkSync(outputPath);
    unlinkSync(errorPath);
    rmdirSync(directory);
  }
};
try {
  run(["open", "http://localhost:3000/auth"]);
  const modulePath = `/@fs/${path.resolve("packages/sync-client/tests/browser-benchmark.ts").replaceAll("\\", "/")}`;
  run(
    ["eval", "--stdin"],
    `void (async () => {
    try {
      const { runReplicaBrowserBenchmark } = await import(${JSON.stringify(modulePath)});
      globalThis.syncBenchmarkResult = { result: await runReplicaBrowserBenchmark() };
    } catch (error) {
      globalThis.syncBenchmarkResult = { error: String(error) };
    }
  })();`
  );
  let completed = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await setTimeout(5000);
    const raw = run(
      ["eval", "--stdin"],
      "JSON.stringify(globalThis.syncBenchmarkResult ?? { progress: globalThis.syncBenchmarkProgress ?? 0 })"
    );
    const serialized: unknown = JSON.parse(raw);
    if (typeof serialized !== "string") {
      throw new TypeError("Browser benchmark output was not serialized.");
    }
    const output: unknown = JSON.parse(serialized);
    if (typeof output !== "object" || output === null) {
      throw new Error("Browser benchmark returned an invalid result.");
    }
    if ("error" in output) {
      throw new Error(String(output.error));
    }
    if ("result" in output) {
      const report = `${JSON.stringify(output.result, null, 2)}\n`;
      await mkdir(".scratch", { recursive: true });
      await writeFile(".scratch/mail-sync-browser-benchmark.json", report);
      process.stdout.write(report);
      completed = true;
      break;
    }
    process.stdout.write(
      `Prepared ${String("progress" in output ? output.progress : 0)} synthetic messages.\n`
    );
  }
  if (!completed) {
    throw new Error("Browser benchmark exceeded ten minutes.");
  }
} finally {
  run(["close"]);
}
