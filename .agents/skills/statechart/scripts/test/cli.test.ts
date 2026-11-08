import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { plainText } from "../backends/plain-text.ts";
import { readMessages } from "../frontends/messages.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = path.join(here, "corpus");
const read = (file: string) => fs.readFileSync(file, "utf8");

function run(
  dir: string,
  {
    args = [],
    view = path.join(dir, "view.mjs"),
    java = path.join(here, "java.ts"),
    command = [process.execPath, path.join(here, "../statechart.ts")],
    env = {},
  }: {
    args?: string[];
    view?: string;
    java?: string;
    command?: string[];
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-cli-"));
  const out = path.join(tmp, "out");
  const log = path.join(tmp, "configs.log");
  const name = path.basename(dir);
  const [file, ...entry] = command;
  const r = spawnSync(
    file,
    [
      ...entry,
      path.join(dir, `${name}.tla`),
      ...(fs.existsSync(view) ? ["--view", view] : []),
      "--out",
      out,
      ...args,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        JAVA: java,
        TLA2TOOLS: "tla2tools.jar",
        STATECHART_REPLAY: dir,
        STATECHART_LOG: log,
        ...env,
      },
    },
  );
  const configs: { [name: string]: string } = {};
  if (fs.existsSync(log))
    for (const c of read(log).split(/^## /m)) if (c) configs[c.slice(0, c.indexOf("\n"))] = c;
  const files = fs.existsSync(out) ? fs.readdirSync(out).sort() : [];
  return {
    ...r,
    out,
    files,
    configs,
    report: files.includes("report.md") ? read(path.join(out, "report.md")) : "",
  };
}

function copyCase(name: string, edit: (dir: string) => void = () => {}) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "statechart-case-")), name);
  fs.cpSync(path.join(corpus, name), dir, { recursive: true });
  edit(dir);
  return dir;
}

function startCommand(
  dir: string,
  parent: string,
  {
    java = path.join(here, "java.ts"),
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-tmpdir-")),
  }: { java?: string; tmpdir?: string } = {},
) {
  const name = path.basename(dir);
  const view = path.join(dir, "view.mjs");
  return spawn(
    process.execPath,
    [
      path.join(here, "../statechart.ts"),
      path.join(dir, `${name}.tla`),
      ...(fs.existsSync(view) ? ["--view", view] : []),
      "--out",
      path.join(parent, "out"),
    ],
    {
      env: {
        ...process.env,
        JAVA: java,
        TLA2TOOLS: "tla2tools.jar",
        STATECHART_REPLAY: dir,
        TMPDIR: tmpdir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function signalWhile<T extends { dir: string; reached: (parent: string) => boolean }>(
  signal: NodeJS.Signals,
  setup: (fakes: string) => T & { java?: string },
) {
  const fakes = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-fakes-"));
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-parent-"));
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-tmpdir-"));
  const phase = setup(fakes);
  const child = startCommand(phase.dir, parent, { java: phase.java, tmpdir });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
  const closed = once(child, "close");
  const end = Date.now() + 60_000;
  while (!phase.reached(parent))
    assert.ok(Date.now() < end, "The command did not reach the phase.");
  child.kill(signal);
  const [status] = await closed;
  assert.equal(stderr, `${signal} stopped the check, so the command wrote nothing.\n`);
  assert.equal(status, 128 + os.constants.signals[signal]);
  assert.deepEqual(fs.readdirSync(parent), []);
  assert.deepEqual(fs.readdirSync(tmpdir), []);
  return phase;
}

async function assertGone(pid: number) {
  for (let i = 0; ; i++) {
    let code: string | undefined;
    try {
      process.kill(pid, 0);
    } catch (error) {
      code = (error as NodeJS.ErrnoException).code;
      // macOS gives EPERM for a process group of only zombies, until they are reaped.
      if (code !== "EPERM") {
        assert.equal(code, "ESRCH");
        return;
      }
    }
    assert.ok(
      i < 250,
      `Process ${pid} ${code ? "exited, but it was not reaped" : "is still running"}.`,
    );
    await sleep(20);
  }
}

async function assertEmpty(dir: string) {
  for (let i = 0; i < 250 && fs.readdirSync(dir).length; i++) await sleep(20);
  assert.deepEqual(fs.readdirSync(dir), []);
}

function gridCase(n: number) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "statechart-case-")), "Grid");
  fs.cpSync(path.join(here, "grid"), dir, { recursive: true });
  for (const run of ["ChartRun.out", "verdict-1.out"])
    fs.copyFileSync(path.join(corpus, "Login", run), path.join(dir, run));
  const id = (x: number, y: number) => String(1_000_000 + x * n + y);
  const lines = ["strict digraph DiskGraph {"];
  for (let x = 0; x < n; x++)
    for (let y = 0; y < n; y++) {
      lines.push(
        `${id(x, y)} [label="/\\\\ x = ${x}\\n/\\\\ y = ${y}"${x + y ? "" : ",style = filled"}]`,
      );
      if (x + 1 < n) lines.push(`${id(x, y)} -> ${id(x + 1, y)} [label="IncX"];`);
      if (y + 1 < n) lines.push(`${id(x, y)} -> ${id(x, y + 1)} [label="IncY"];`);
    }
  lines.push("}");
  fs.writeFileSync(path.join(dir, "graph.dot"), lines.join("\n"));
  return dir;
}

function sleepyJava(fakes: string) {
  const java = path.join(fakes, "java.mjs");
  const pidFile = path.join(fakes, "java.pid");
  fs.writeFileSync(
    java,
    `#!/usr/bin/env node\nimport fs from "node:fs";\n` +
      `process.on("SIGTERM", () => {});\n` +
      `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n` +
      `setTimeout(() => {}, 60_000);\n`,
    { mode: 0o755 },
  );
  return { java, pidFile };
}

test(
  "a SIGKILL of the command stops TLC, removes the temporary folder, and writes nothing",
  { timeout: 30_000 },
  async () => {
    const fakes = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-fakes-"));
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-parent-"));
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-tmpdir-"));
    const { java, pidFile } = sleepyJava(fakes);
    const child = startCommand(path.join(corpus, "DieHard"), parent, { java, tmpdir });
    const exited = once(child, "exit");
    while (!fs.existsSync(pidFile)) await sleep(20);
    child.kill("SIGKILL");
    await exited;
    await assertGone(Number(read(pidFile)));
    await assertEmpty(parent);
    await assertEmpty(tmpdir);
  },
);

test(
  "a SIGKILL of the command while the view draws the chart leaves no folder behind",
  { timeout: 30_000 },
  async () => {
    const fakes = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-fakes-"));
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-parent-"));
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-tmpdir-"));
    const drawing = path.join(fakes, "drawing");
    const release = path.join(fakes, "release");
    const dir = copyCase("Login", (d) =>
      fs.writeFileSync(
        path.join(d, "view.mjs"),
        `import fs from "node:fs";\n` +
          `export const state = (v) => {\n` +
          `  if (!fs.existsSync(${JSON.stringify(drawing)})) {\n` +
          `    fs.writeFileSync(${JSON.stringify(drawing)}, String(process.pid));\n` +
          `    for (const end = Date.now() + 20_000; Date.now() < end && !fs.existsSync(${JSON.stringify(release)}); );\n` +
          `  }\n` +
          `  return JSON.stringify(v);\n` +
          `};\n`,
      ),
    );
    const child = startCommand(dir, parent, { tmpdir });
    const exited = once(child, "exit");
    while (!fs.existsSync(drawing) || !read(drawing)) await sleep(20);
    child.kill("SIGKILL");
    await exited;
    fs.writeFileSync(release, "");
    await assertGone(-Number(read(drawing)));
    await assertEmpty(parent);
    await assertEmpty(tmpdir);
  },
);

test(
  "a check killed by a signal stops the command with exit 2, and it writes nothing",
  { timeout: 30_000 },
  async () => {
    const fakes = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-fakes-"));
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-parent-"));
    const { java, pidFile } = sleepyJava(fakes);
    const child = startCommand(path.join(corpus, "DieHard"), parent, { java });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
    const closed = once(child, "close");
    while (!fs.existsSync(pidFile) || !read(pidFile)) await sleep(20);
    const ps = spawnSync("ps", ["-o", "ppid=", "-p", read(pidFile)], { encoding: "utf8" });
    process.kill(Number(ps.stdout), "SIGKILL");
    const [status] = await closed;
    assert.equal(stderr, "SIGKILL killed the check, so the command wrote nothing.\n");
    assert.equal(status, 2);
    assert.deepEqual(fs.readdirSync(parent), []);
  },
);

for (const signal of ["SIGINT", "SIGTERM"] satisfies NodeJS.Signals[]) {
  test(
    `${signal} stops TLC, removes the temporary folder, and writes nothing`,
    { timeout: 30_000 },
    async () => {
      const { pidFile } = await signalWhile(signal, (fakes) => {
        const fake = sleepyJava(fakes);
        return {
          dir: path.join(corpus, "DieHard"),
          ...fake,
          reached: () => fs.existsSync(fake.pidFile),
        };
      });
      await assertGone(Number(read(pidFile)));
    },
  );

  test(
    `${signal} while the view draws the chart stops the command, and it writes nothing`,
    { timeout: 60_000 },
    () =>
      signalWhile(signal, (fakes) => {
        const drawing = path.join(fakes, "drawing");
        const dir = copyCase("Login", (d) =>
          fs.writeFileSync(
            path.join(d, "view.mjs"),
            `import fs from "node:fs";\n` +
              `export const state = (v) => {\n` +
              `  if (!fs.existsSync(${JSON.stringify(drawing)})) {\n` +
              `    fs.writeFileSync(${JSON.stringify(drawing)}, "");\n` +
              `    for (const end = Date.now() + 30_000; Date.now() < end; );\n` +
              `  }\n` +
              `  return JSON.stringify(v);\n` +
              `};\n`,
          ),
        );
        return { dir, reached: () => fs.existsSync(drawing) };
      }),
  );

  test(
    `${signal} while the command writes its files stops it, and it writes nothing`,
    { timeout: 60_000 },
    () =>
      signalWhile(signal, () => ({
        dir: gridCase(150),
        reached: (parent) => {
          for (const f of fs.readdirSync(parent, { recursive: true, encoding: "utf8" }))
            if (
              path.basename(f) === "chart.mmd" &&
              fs.statSync(path.join(parent, f), { throwIfNoEntry: false })?.size
            )
              return true;
          return false;
        },
      })),
  );
}

for (const signal of ["SIGINT", "SIGTERM"] satisfies NodeJS.Signals[]) {
  test(`${signal} while the command reads TLC's last output stops the check and writes nothing`, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-late-"));
    const java = path.join(tmp, "java.mjs");
    const tmpdir = path.join(tmp, "tmpdir");
    fs.mkdirSync(tmpdir);
    const sendWhileRead = `const fs = require("node:fs");
const [dot, pid, signal, graph] = process.argv.slice(1);
setTimeout(() => process.exit(1), 30_000).unref();
fs.open(dot, "w", (error, fd) => {
  process.kill(Number(pid), signal);
  fs.writeSync(fd, fs.readFileSync(graph));
  fs.closeSync(fd);
});`;
    fs.writeFileSync(
      java,
      `#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const dot = args[args.indexOf("-dump") + 2] + ".dot";
spawnSync("mkfifo", [dot]);
const command = spawnSync("ps", ["-o", "ppid=", "-p", String(process.ppid)], { encoding: "utf8" }).stdout.trim();
spawn(process.execPath, ["-e", ${JSON.stringify(sendWhileRead)}, dot, command, ${JSON.stringify(signal)}, ${JSON.stringify(path.join(corpus, "Login", "graph.dot"))}], { detached: true, stdio: "ignore" }).unref();
`,
      { mode: 0o755 },
    );
    const r = run(path.join(corpus, "Login"), { java, env: { TMPDIR: tmpdir } });
    assert.equal(r.stderr, `${signal} stopped the check, so the command wrote nothing.\n`);
    assert.equal(r.status, 128 + os.constants.signals[signal]);
    assert.deepEqual(fs.readdirSync(tmpdir), []);
    assert.equal(fs.existsSync(r.out), false);
  });
}

test("a broken property is named in the report, and its TLC trace is in tlc-NAME.out", () => {
  const dir = path.join(corpus, "MediaPlayerProps");
  const r = run(dir);
  assert.equal(r.status, 1);
  for (const p of ["EventuallyPlays", "QuietWhenStopped"]) {
    assert.match(r.report, new RegExp(`^## ${p} breaks\n.*tlc-${p}\\.out`, "m"));
    const out = read(path.join(r.out, `tlc-${p}.out`));
    const from: string[] = [];
    for (const name of Object.keys(r.configs)) {
      const tool = name.startsWith("verdict-") && read(path.join(dir, `${name}.out`));
      if (tool && out === `${[...plainText(readMessages(tool))].join("")}\n`) from.push(name);
    }
    assert.equal(from.length, 1, p);
    assert.match(r.configs[from[0]], new RegExp(`^PROPERTY ${p}$`, "m"));
    assert.match(out, /^TLC2 Version /);
    assert.doesNotMatch(out, /@!@!@/);
  }
  assert.match(read(path.join(r.out, "tlc-QuietWhenStopped.out")), /^State 2: <YouTurnItUp /m);
  assert.match(r.report, /^## Rules that hold\n.*\bEventuallyStops\b.*\bStaysTyped\b/m);
});

test("a later verdict run that TLC cannot finish keeps the exit and leaves its rules not checked", () => {
  const dir = copyCase("CounterJump", (d) =>
    fs.writeFileSync(path.join(d, "verdict-2.exit"), "150\n"),
  );
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.report, /^## NotThree breaks$/m);
  assert.match(
    r.report,
    /^## Rules not checked\nNoDeadlock\nTLC stopped with exit 150 before it checked this rule:$/m,
  );
});

test("a java that cannot start stops the command with exit 2 on a runtime that emits no close for it", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-no-java-"));
  const noClose = path.join(tmp, "no-close.mjs");
  fs.writeFileSync(
    noClose,
    `import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const { spawn } = childProcess;
childProcess.spawn = (...args) => {
  const child = spawn(...args);
  const { emit } = child;
  child.emit = (name, ...rest) =>
    name === "close" && child.pid === undefined ? false : emit.call(child, name, ...rest);
  return child;
};
syncBuiltinESMExports();
`,
  );
  const java = path.join(tmp, "java");
  const spec = path.join(corpus, "Login", "Login.tla");
  const r = run(path.dirname(spec), {
    java,
    command: [
      process.execPath,
      `--import=${pathToFileURL(noClose).href}`,
      path.join(here, "../statechart.ts"),
    ],
  });
  assert.equal(r.stderr, `SANY could not read ${spec} (exit null):\nspawn ${java} ENOENT\n`);
  assert.equal(r.status, 2);
  assert.equal(fs.existsSync(r.out), false);
});

test("a view that hides a step of a bug path stops the command with exit 2", () => {
  const dir = path.join(corpus, "MediaPlayer");
  const view = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "statechart-view-")), "view.mjs");
  fs.writeFileSync(
    view,
    `export * from ${JSON.stringify(path.join(dir, "view.mjs"))};\n` +
      `export const step = (action) => (action === "YouTurnItUp" ? null : action);\n`,
  );
  const r = run(dir, { view });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /LoudWhenStopped/);
  assert.deepEqual(r.files, []);
});

const writeView = (body: string) => {
  const view = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "statechart-view-")), "view.mjs");
  fs.writeFileSync(view, body);
  return view;
};

test("a view that ends the check while TLC runs stops TLC, and the command exits 2 and writes nothing", async () => {
  const { java, pidFile } = sleepyJava(fs.mkdtempSync(path.join(os.tmpdir(), "statechart-fakes-")));
  const r = run(path.join(corpus, "Login"), {
    java,
    view: writeView(
      'import fs from "node:fs";\n' +
        `setInterval(() => fs.existsSync(${JSON.stringify(pidFile)}) && process.exit(1), 20);\n` +
        "export const state = (v) => JSON.stringify(v);\n",
    ),
  });
  assert.equal(r.status, 2);
  assert.deepEqual(r.files, []);
  await assertGone(Number(read(pidFile)));
});

test("a flat view names a label with U+0000 as written when a loop cannot take a step out of it", () => {
  const view = writeView(
    `export const state = (v) => (v.playback === "Stopped" || v.volume === "Muted" ? ${JSON.stringify("a\0b")} : v.playback);\n`,
  );
  const r = run(path.join(corpus, "MediaPlayerProps"), { view });
  assert.equal(r.status, 2);
  assert.equal(
    r.stderr,
    "The chart draws the step TheCallEnds out of a\0b, but the EventuallyPlays loop cannot take it there. Show in a label what stops it.\n",
  );
  assert.deepEqual(r.files, []);
});

const contents = (p: string) => {
  const stat = fs.lstatSync(p);
  if (stat.isSymbolicLink()) return fs.readlinkSync(p);
  if (!stat.isDirectory()) return read(p);
  const files: { [name: string]: string } = {};
  for (const f of fs.readdirSync(p)) files[f] = read(path.join(p, f));
  return files;
};
const newPath = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "statechart-out-")), "out");

for (const [what, make, words] of [
  [
    "a folder of the user's files",
    (out) => {
      fs.mkdirSync(out);
      fs.writeFileSync(path.join(out, ".bashrc"), "export PATH\n");
      fs.writeFileSync(path.join(out, "report.md"), "# My quarterly report\n");
      fs.writeFileSync(path.join(out, "tlc-Build.out"), "build log\n");
    },
    /is not empty\. It has \.bashrc\./,
  ],
  [
    "a folder that holds only a dotfile",
    (out) => {
      fs.mkdirSync(out);
      fs.writeFileSync(path.join(out, ".bashrc"), "export PATH\n");
    },
    /is not empty\. It has \.bashrc\./,
  ],
  [
    "the folder of an earlier run",
    (out) =>
      assert.equal(run(path.join(corpus, "MediaPlayerProps"), { args: ["--out", out] }).status, 1),
    /is not empty\. It has chart\.mmd\./,
  ],
  [
    "a file",
    (out) => fs.writeFileSync(out, "keep me\n"),
    /cannot be the output folder\. ENOTDIR: not a directory/,
  ],
  [
    "a broken link",
    (out) => fs.symlinkSync(path.join(path.dirname(out), "gone"), out),
    /cannot be the output folder\. It is a broken link\./,
  ],
] satisfies [string, (out: string) => void, RegExp][]) {
  test(`an --out that is ${what} stops the command with exit 2 before TLC runs, and keeps what is there`, () => {
    const out = newPath();
    make(out);
    const before = contents(out);
    const r = run(path.join(corpus, "Login"), { args: ["--out", out] });
    assert.equal(r.status, 2);
    assert.ok(r.stderr.includes(out), r.stderr);
    assert.match(r.stderr, words);
    assert.match(r.stderr, /Pass --out with a new folder\.\n$/);
    assert.deepEqual(r.configs, {});
    assert.deepEqual(contents(out), before);
  });
}

test("a file that appears in --out while TLC runs is kept, and the command stops with exit 2", () => {
  const out = newPath();
  const mine = path.join(out, "report.md");
  const java = path.join(path.dirname(out), "java.sh");
  fs.writeFileSync(
    java,
    `#!/bin/sh\nmkdir -p ${JSON.stringify(out)}\n` +
      `[ -e ${JSON.stringify(mine)} ] || echo mine > ${JSON.stringify(mine)}\n` +
      `exec ${JSON.stringify(path.join(here, "java.ts"))} "$@"\n`,
    { mode: 0o755 },
  );
  const r = run(path.join(corpus, "Login"), { args: ["--out", out], java });
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes(mine), r.stderr);
  assert.equal(read(mine), "mine\n");
});

for (const [what, config, words] of [
  [
    "a misspelled first keyword",
    "\\* The rules\nINVARIENT NeverLocked\nSPECIFICATION Spec\n",
    /^TLC refuses .*Login\.cfg at line 2\. It was expecting a keyword, but did not find it\.$/m,
  ],
  [
    "a CHECK_DEADLOCK value in lower case",
    "SPECIFICATION Spec\nINVARIANT TypeOK\nCHECK_DEADLOCK false\n",
    /Login\.cfg at line 3\. It was expecting TRUE or FALSE, but did not find it\./,
  ],
  [
    "an ALIAS line",
    "SPECIFICATION Spec\nINVARIANT TypeOK\nVIEW vars\nALIAS Pretty\n",
    /Login\.cfg at line 4\. It was expecting a keyword, but did not find it\./,
  ],
  [
    "a comma between invariants",
    "SPECIFICATION Spec\nINVARIANT TypeOK, NeverLocked\n",
    /Login\.cfg at line 2\. The invariant , specified in the configuration file is not defined in the specification\./,
  ],
  [
    "a keyword two times",
    "SPECIFICATION Spec\nINVARIANT TypeOK\nSPECIFICATION Spec\n",
    /Login\.cfg at line 3\. The keyword SPECIFICATION appeared twice\./,
  ],
  [
    "a constant value that TLC cannot read",
    "CONSTANT N = -1\nSPECIFICATION Spec\n",
    /Login\.cfg at line 1\..*"-"/,
  ],
  [
    "both SPECIFICATION and NEXT",
    "SPECIFICATION Spec\nNEXT Next\nINVARIANT TypeOK\n",
    /^TLC refuses the config .*Login\.cfg\. The configuration file cannot specify both INIT\/NEXT and SPECIFICATION fields\.$/m,
  ],
  [
    "no SPECIFICATION and no INIT",
    "\\* The rules\nINVARIANT TypeOK\n",
    /^TLC refuses the config .*Login\.cfg\. The configuration file did not specify the initial state predicate\.$/m,
  ],
  [
    "an operator constant with no arguments",
    "CONSTANT f() = 1\nSPECIFICATION Spec\n",
    /^TLC refuses .*Login\.cfg at line 1\. TLC gives no reason here\. An operator's arguments are one or more values in \( \), with commas between them\.$/m,
  ],
  [
    "operator arguments with no closing parenthesis",
    "SPECIFICATION Spec\n\nCONSTANT f(1, 2 = 3\n",
    /^TLC refuses .*Login\.cfg at line 3\. TLC gives no reason here\. An operator's arguments are one or more values in \( \), with commas between them\.$/m,
  ],
  [
    "a CONSTANT keyword on its own line before operator arguments with no closing parenthesis",
    "SPECIFICATION Spec\nCONSTANT\nf(1, 2\n= 3\n",
    /^TLC refuses .*Login\.cfg at line 2\. TLC gives no reason here\. An operator's arguments are one or more values in \( \), with commas between them\.$/m,
  ],
  [
    "a comma invariant before a CHECK_DEADLOCK value in lower case",
    "SPECIFICATION Spec\nINVARIANT ,\nCHECK_DEADLOCK false\n",
    /Login\.cfg at line 3\. It was expecting TRUE or FALSE, but did not find it\./,
  ],
  [
    "a comment that does not end",
    "SPECIFICATION Spec\nINVARIANT TypeOK\n(* The view\nVIEW vars\n",
    /Login\.cfg at line 3\..*\bcomment\b/,
  ],
  [
    "CHECK_DEADLOCK FALSE in a comment that does not end",
    "INVARIANT TypeOK\nSPECIFICATION Spec\n(* CHECK_DEADLOCK FALSE\n",
    /Login\.cfg at line 3\. A comment starts here and does not end\./,
  ],
  [
    "a no-break space before CHECK_DEADLOCK FALSE",
    "SPECIFICATION Spec\nINVARIANT TypeOK\n\u00a0CHECK_DEADLOCK FALSE\n",
    /Login\.cfg at line 3\. It cannot read the character "\u00a0" \(U\+00A0\) outside a string\./,
  ],
  [
    "a line separator before CHECK_DEADLOCK FALSE",
    "SPECIFICATION Spec\nINVARIANT TypeOK\u2028CHECK_DEADLOCK FALSE\n",
    /Login\.cfg at line 2\. It cannot read the character "\u2028" \(U\+2028\) outside a string\./,
  ],
  [
    "a byte order mark",
    "\uFEFFSPECIFICATION Spec\nINVARIANT TypeOK\n",
    /Login\.cfg at line 1\. The file starts with a byte order mark\. Save it as UTF-8 without one\.$/m,
  ],
] satisfies [string, string, RegExp][]) {
  test(`a config with ${what} stops the command with exit 2 before TLC runs`, () => {
    const dir = copyCase("Login", (d) => fs.writeFileSync(path.join(d, "Login.cfg"), config));
    const r = run(dir);
    assert.equal(r.status, 2);
    assert.match(r.stderr, words);
    assert.deepEqual(r.configs, {});
    assert.deepEqual(r.files, []);
  });
}
