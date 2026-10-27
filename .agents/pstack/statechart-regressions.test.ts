import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const scripts = path.resolve(import.meta.dirname, "../skills/statechart/scripts");

test("correlated initial regions fall back without exhausting a bounded process", (context) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-regions-"));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [
    "--max-old-space-size=64",
    "--input-type=module",
    "-e",
    `import assert from "node:assert/strict";
import { project } from ${JSON.stringify(pathToFileURL(path.join(scripts, "pipeline.ts")).href)};
import { walk } from ${JSON.stringify(pathToFileURL(path.join(scripts, "passes/reach.ts")).href)};
const graph = { states: new Map(), steps: [] };
for (let value = 0; value < 100; value++) {
  graph.states.set(String(value), { vars: { value }, start: true, breaks: [] });
}
const { chart } = project(graph, walk(graph), {
  state: ({ value }) => ({ A: String(value), B: String(value), C: String(value), D: String(value) }),
}, []);
assert.ok(chart.lie);
assert.equal(chart.regions.length, 1);`,
  ], { cwd: scratch, encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr);
});

test("correlated synchronized moves fall back without exhausting a bounded process", (context) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-region-moves-"));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [
    "--max-old-space-size=64",
    "--input-type=module",
    "-e",
    `import assert from "node:assert/strict";
import { project } from ${JSON.stringify(pathToFileURL(path.join(scripts, "pipeline.ts")).href)};
import { walk } from ${JSON.stringify(pathToFileURL(path.join(scripts, "passes/reach.ts")).href)};
const graph = { states: new Map(), steps: [] };
for (let value = 0; value <= 100; value++) {
  graph.states.set(String(value), { vars: { value }, start: value === 0, breaks: [] });
  if (value) graph.steps.push({ from: "0", to: String(value), action: "Choose" });
}
const { chart } = project(graph, walk(graph), {
  state: ({ value }) => ({ A: String(value), B: String(value), C: String(value), D: String(value) }),
}, []);
assert.ok(chart.lie);
assert.equal(chart.regions.length, 1);`,
  ], { cwd: scratch, encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr);
});

test("explicit relative Java and TLC paths work after the checker changes directories", (context) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-relative-tools-"));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const java = path.join(scratch, "java");
  const jar = path.join(scratch, "tla2tools.jar");
  fs.writeFileSync(jar, "test fixture");
  fs.writeFileSync(java, `#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
const args = process.argv.slice(2);
assert.ok(existsSync(args[args.indexOf("-cp") + 1]));
await import(${JSON.stringify(pathToFileURL(path.join(scripts, "test/java.ts")).href)});
`, { mode: 0o755 });

  for (const [executable, archive] of [
    [java, "./tla2tools.jar"],
    ["./java", jar],
    ["./java", "./tla2tools.jar"],
    ["java", "./tla2tools.jar"],
  ]) {
    const out = path.join(scratch, `output-${fs.readdirSync(scratch).length}`);
    const result = spawnSync(process.execPath, [
      path.join(scripts, "statechart.ts"),
      path.join(scripts, "test/corpus/Counter/Counter.tla"),
      "--out", out,
    ], {
      cwd: scratch,
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...process.env,
        JAVA: executable,
        TLA2TOOLS: archive,
        STATECHART_REPLAY: path.join(scripts, "test/corpus/Counter"),
        PATH: `${scratch}${path.delimiter}${process.env.PATH}`,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(out, "chart.mmd")));
    assert.ok(fs.existsSync(path.join(out, "report.md")));
  }
});
