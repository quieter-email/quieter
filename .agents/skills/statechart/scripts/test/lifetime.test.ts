import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, "..");
const firstRule = path.join(here, "corpus", "FirstRule");

function limited(args: string[], replay: string, tmpdir: string) {
  return spawnSync(
    "/bin/sh",
    ["-c", 'ulimit -n 64\nexec "$@"', "sh", process.execPath, ...args],
    {
      encoding: "utf8",
      timeout: 60_000,
      env: {
        ...process.env,
        JAVA: path.join(here, "java.ts"),
        TLA2TOOLS: "tla2tools.jar",
        STATECHART_REPLAY: replay,
        STATECHART_RECORD: "",
        TMPDIR: tmpdir,
      },
    },
  );
}

test("repeated checks can reread and stop reading output within a small descriptor budget", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-lifetime-"));
  try {
    const code = `
      import assert from "node:assert/strict";
      import { setImmediate } from "node:timers/promises";
      import { inspect } from "node:util";
      import { check } from ${JSON.stringify(pathToFileURL(path.join(scripts, "run.ts")).href)};
      import { compile } from ${JSON.stringify(pathToFileURL(path.join(scripts, "pipeline.ts")).href)};
      import { checkView } from ${JSON.stringify(pathToFileURL(path.join(scripts, "frontends/view.ts")).href)};
      const [spec, config] = process.argv.slice(1);
      for (let i = 0; i < 12; i++) {
        const exit = await check(spec, config, async (result) => {
          await setImmediate();
          for (let j = 0; j < 12; j++) {
            for (const part of result.messages) {
              assert.ok(part);
              break;
            }
          }
          let previous;
          for (let j = 0; j < 2; j++) {
            const text = new Map();
            for (const [name, parts] of compile(result, checkView({}, inspect)).files)
              text.set(name, [...parts].join(""));
            assert.ok(text.get("tlc.out").includes("Invariant"));
            if (previous) assert.deepEqual(text, previous);
            previous = text;
          }
          return result.exit;
        });
        assert.equal(exit, 1);
      }
    `;
    const r = limited(
      [
        "--input-type=module",
        "-e",
        code,
        path.join(firstRule, "FirstRule.tla"),
        path.join(firstRule, "FirstRule.cfg"),
      ],
      firstRule,
      tmp,
    );
    assert.equal(r.status, 0, r.error?.message ?? r.stderr);
    assert.deepEqual(fs.readdirSync(tmp), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("many failing invariants serialize all verdicts within a small descriptor budget", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-lifetime-"));
  const dir = path.join(tmp, "FirstRule");
  const scratch = path.join(tmp, "scratch");
  const out = path.join(tmp, "out");
  fs.mkdirSync(scratch);
  fs.cpSync(firstRule, dir, { recursive: true });
  try {
    const rules = Array.from({ length: 40 }, (_, i) => `Guard${i}`);
    fs.writeFileSync(
      path.join(dir, "FirstRule.cfg"),
      `INIT Init\nNEXT Next\nINVARIANTS ${rules.join(" ")}\nCHECK_DEADLOCK FALSE\n`,
    );
    const tla = fs.readFileSync(path.join(dir, "FirstRule.tla"), "utf8");
    fs.writeFileSync(
      path.join(dir, "FirstRule.tla"),
      tla.replace("====", `${rules.map((name) => `${name} == x # 1`).join("\n")}\n====`),
    );
    const output = fs.readFileSync(path.join(firstRule, "verdict-1.out"), "utf8");
    for (const [i, rule] of rules.entries()) {
      fs.writeFileSync(path.join(dir, `verdict-${i + 1}.out`), output.replace(/NotOne/g, rule));
      fs.copyFileSync(
        path.join(firstRule, "verdict-1.exit"),
        path.join(dir, `verdict-${i + 1}.exit`),
      );
    }
    const r = limited(
      [path.join(scripts, "statechart.ts"), path.join(dir, "FirstRule.tla"), "--out", out],
      dir,
      scratch,
    );
    assert.equal(r.status, 1, r.error?.message ?? r.stderr);
    const report = fs.readFileSync(path.join(out, "report.md"), "utf8");
    for (const rule of rules) assert.match(report, new RegExp(`^## ${rule} breaks$`, "m"));
    assert.ok(fs.readFileSync(path.join(out, "tlc.out"), "utf8").includes("Guard0"));
    assert.deepEqual(fs.readdirSync(scratch), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("failed consumers and tool errors remove scratch output before rejecting", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-lifetime-"));
  const replay = path.join(tmp, "replay");
  const scratch = path.join(tmp, "scratch");
  const java = path.join(tmp, "partial-open.ts");
  fs.mkdirSync(scratch);
  fs.cpSync(firstRule, replay, { recursive: true });
  fs.writeFileSync(
    java,
    `#!/usr/bin/env node\nimport fs from "node:fs";\nfs.mkdirSync("verdict-1.stderr");\nawait import(${JSON.stringify(pathToFileURL(path.join(here, "java.ts")).href)});\n`,
    { mode: 0o755 },
  );
  try {
    const code = `
      import assert from "node:assert/strict";
      import fs from "node:fs";
      import { setImmediate } from "node:timers/promises";
      import { check } from ${JSON.stringify(pathToFileURL(path.join(scripts, "run.ts")).href)};
      const [spec, config, scratch, sanyExit, java] = process.argv.slice(1);
      const failure = new Error("consumer failed");
      for (let i = 0; i < 12; i++) {
        await assert.rejects(check(spec, config, (result) => {
          for (const part of result.messages) throw failure;
        }), (error) => error === failure);
        assert.deepEqual(fs.readdirSync(scratch), []);
        await assert.rejects(check(spec, config, async (result) => {
          await setImmediate();
          for (const part of result.messages) throw failure;
        }), (error) => error === failure);
        assert.deepEqual(fs.readdirSync(scratch), []);
      }
      fs.writeFileSync(sanyExit, "1");
      await assert.rejects(check(spec, config, () => assert.fail("consumer ran after a tool error")), /SANY/);
      assert.deepEqual(fs.readdirSync(scratch), []);
      fs.rmSync(sanyExit);
      process.env.JAVA = java;
      for (let i = 0; i < 48; i++) {
        await assert.rejects(check(spec, config, () => assert.fail("consumer ran after an output error")), { code: "EISDIR" });
        assert.deepEqual(fs.readdirSync(scratch), []);
      }
    `;
    const r = limited(
      [
        "--input-type=module",
        "-e",
        code,
        path.join(firstRule, "FirstRule.tla"),
        path.join(firstRule, "FirstRule.cfg"),
        scratch,
        path.join(replay, "sany.exit"),
        java,
      ],
      replay,
      scratch,
    );
    assert.equal(r.status, 0, r.error?.message ?? r.stderr);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
