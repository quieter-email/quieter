import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { inspect } from "node:util";
import { fileURLToPath } from "node:url";
import { mermaid } from "../backends/mermaid.ts";
import { report } from "../backends/report.ts";
import { readConfig } from "../frontends/config.ts";
import { readChecks, readSany, readSpec } from "../frontends/spec.ts";
import { checkView, json } from "../frontends/view.ts";
import {
  type Bug,
  EC,
  type Graph,
  hasSection,
  key,
  LEVEL,
  type Rule,
  show,
  type Spec,
  stateRules,
  type Step,
  type Value,
  type Vars,
  type View,
} from "../ir.ts";
import { addPast, deadEnds, finder, lasso, mark } from "../passes/annotate.ts";
import { pathGraph } from "../passes/paths.ts";
import { bugs, walk } from "../passes/reach.ts";
import { parseDot } from "../frontends/dot.ts";
import { parseValue } from "../frontends/value.ts";
import { readCounterexample, readMarks } from "../frontends/marks.ts";
import { readMessages } from "../frontends/messages.ts";
import { readTrace } from "../frontends/trace.ts";
import { readVerdict } from "../frontends/verdict.ts";
import { compile, project } from "../pipeline.ts";
import { fileLines } from "../run.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = (name: string, file: string) => path.join(here, "corpus", name, file);

const corpusSpec = (name: string) => {
  const configFile = corpus(name, `${name}.cfg`);
  const config = readConfig({ file: configFile, text: fs.readFileSync(configFile, "utf8") });
  return readSpec({
    module: name,
    sany: readSany(fs.readFileSync(corpus(name, "sany.out"), "utf8")),
    checks: readChecks({ configFile, config }),
  });
};

type StateRow = [id: string, vars: Vars, start?: boolean, breaks?: string[]];
type StepRow = [from: string, to: string, action: string];

const graphOf = (states: StateRow[], steps: StepRow[]) => {
  const graph: Graph = { states: new Map(), steps: [] };
  for (const [id, vars, start, breaks = []] of states) {
    const rules: Rule[] = [];
    for (const name of breaks) rules.push({ kind: "invariant", name });
    graph.states.set(id, { vars, start: !!start, breaks: rules });
  }
  for (const [from, to, action] of steps) graph.steps.push({ from, to, action });
  return graph;
};

const lookup = <K, V>(map: ReadonlyMap<K, V>, k: K) => {
  const v = map.get(k);
  assert.ok(v !== undefined, `${inspect(k)} is missing`);
  return v;
};

const field = (value: Value, name: string) => {
  if (typeof value !== "object" || value.kind !== "function")
    throw new Error(`${inspect(value)} is not a function.`);
  for (let i = 0; i < value.keys.length; i++) {
    const k = value.keys[i];
    if (k === name || (typeof k === "object" && k.kind === "model" && k.name === name))
      return value.values[i];
  }
  throw new Error(`${inspect(value)} has no ${name}.`);
};

function draw(graph: Graph, view: View, loops: Bug[] = []) {
  const found = [...bugs(graph), ...loops];
  const { chart, stories } = project(graph, walk(graph), view, found);
  const spec: Spec = {
    module: "Test",
    variables: [],
    invariants: [],
    properties: [],
    deadlock: false,
    written: [],
  };
  const result = {
    spec,
    graph,
    paths: undefined,
    rules: [],
    properties: [],
    stop: undefined,
    drawing: undefined,
    states: { distinct: graph.states.size, initial: 1, complete: true, cut: false },
  };
  return { chart: mermaid(chart), report: report(result, found, chart, stories) };
}

const marked = (chart: string) => {
  const out: { [label: string]: string } = {};
  for (const [, id, cls] of chart.matchAll(/^ {2}class (s\d+) (breaks|mayBreak)$/gm)) {
    const label = chart.match(new RegExp(`^\\s*${id}: (.*)$`, "m"))?.[1];
    assert.ok(label !== undefined, `${id} has no label`);
    out[label] = cls;
  }
  return out;
};

test("TLA+ values reach the view as the skill says: sequences from 1, sets as arrays", () => {
  const seen = (text: string) => json(parseValue(text));
  assert.deepEqual(seen('<<1, "a", <<>>>>'), { 1: 1, 2: "a", 3: {} });
  assert.deepEqual(seen("{r1, -2}"), ["r1", -2]);
  assert.deepEqual(seen("{}"), []);
  assert.deepEqual(seen("-1..2"), [-1, 0, 1, 2]);
  assert.deepEqual(seen('[ok |-> TRUE, msg |-> "say \\"hi\\""]'), {
    ok: true,
    msg: 'say "hi"',
  });
  assert.deepEqual(seen("[]"), {});
  assert.deepEqual(seen('(r1 :> "working" @@ r2 :> "aborted")'), {
    r1: "working",
    r2: "aborted",
  });
});

test("a value outside the grammar TLC prints is an error, never a guess", () => {
  for (const text of [
    "<<1, 2",
    "<<1 2>>",
    "{1,}",
    "[1 |-> 2]",
    "[a |-> 1,]",
    "[,]",
    "(1 :> 2",
    "1..",
    "1..x",
    '"\\q"',
    "x y",
    "",
    "SUBSET {1}",
    "[S -> T]",
  ])
    assert.throws(() => parseValue(text), /cannot read TLA\+ value/, text);
});

test("a label prints each value in TLA+, so values that TLC tells apart look apart", () => {
  const shown = (text: string) => show(parseValue(text));
  for (const text of [
    '"A"',
    "A",
    "<<0>>",
    '("1" :> 0)',
    "[a |-> 1]",
    "[]",
    "1..3",
    "{1, 2, 3}",
    "<<>>",
    "{}",
    "TRUE",
    '"TRUE"',
    '"a\\nb\\tc\\"d\\\\e"',
    '(<<1, 2>> :> {A, "A"} @@ 0 :> -1)',
  ])
    assert.equal(shown(text), text);
});

test("equal TLA+ values share one key and unequal ones do not, as TLC compares them", () => {
  const same = [
    ["1..3", "{1, 2, 3}"],
    ["1..3", "{3, 1, 2, 2}"],
    ["{1..2, {1, 2}}", "{{1, 2}}"],
    ["{}", "1..0"],
    ["{5}", "5..5"],
    ["{0, 1, 2, 4, 5, 7}", "{7, 4, 5, 2, 1, 0}"],
    ["<<0>>", "(1 :> 0)"],
    ["<<4, 5>>", "(2 :> 5 @@ 1 :> 4)"],
    ["[a |-> 1, b |-> 2]", '("b" :> 2 @@ "a" :> 1)'],
    ["[]", "<< >>"],
    ["{A, B}", "{B, A}"],
    ['{"b", "a"}', '{"a", "b"}'],
  ];
  for (const [a, b] of same) assert.equal(key(parseValue(a)), key(parseValue(b)), `${a} = ${b}`);
  const apart = [
    ['"A"', "A"],
    ["<<0>>", '("1" :> 0)'],
    ["<<>>", "{}"],
    ["1..3", "{1, 2}"],
    ["1..3", "{1, 2, 3, 4}"],
    ["{1, 3}", "1..3"],
    ["TRUE", '"TRUE"'],
    ["1", '"1"'],
    ["<<1, 2>>", '"<<1, 2>>"'],
    ["(2 :> 0)", "<<0>>"],
    ["(0 :> 1 @@ 1 :> 2)", "<<1, 2>>"],
    ["[a |-> 1]", "[a |-> 2]"],
    ["{<<1>>}", "{<<2>>}"],
  ];
  for (const [a, b] of apart)
    assert.notEqual(key(parseValue(a)), key(parseValue(b)), `${a} # ${b}`);
});

function replay(name: string, graph: Graph) {
  const spec = corpusSpec(name);
  const names = spec.variables;
  const rules = stateRules(spec);
  const find = finder(graph, names);
  const marks = readMarks(readMessages(fileLines(corpus(name, "ChartRun.out"))), "chart");
  const past = mark(graph, marks, names, rules, find);
  const drawn = !fs.existsSync(corpus(name, "ChartRun.exit"));
  for (const f of fs.readdirSync(path.join(here, "corpus", name)).sort()) {
    if (!/^verdict-\d+\.out$/.test(f)) continue;
    const messages = [...readMessages(fileLines(corpus(name, f)))];
    const { broke } = readVerdict(messages);
    if (!broke) continue;
    let rule: Rule | undefined;
    for (const r of rules)
      if (r.kind === broke.kind && (broke.kind === "deadlock" || r.name === broke.name)) rule = r;
    if (!rule) continue;
    if (rule.kind === "deadlock" && drawn && !hasSection(spec, "CONSTRAINT", "ACTION_CONSTRAINT"))
      deadEnds(graph, rule);
    const counterexample = readCounterexample(messages);
    if (drawn || lasso(graph, { seq: counterexample, loop: undefined }, names, find))
      addPast(
        graph,
        counterexample,
        names,
        rule,
        past,
        hasSection(spec, "ACTION_CONSTRAINT"),
        find,
      );
  }
}

test("each corpus bug path is the shortest way to its rule", () => {
  const paths: { [rule: string]: string[] } = {};
  for (const name of ["DieHard", "MediaPlayer", "LoginParallel", "TwoPhase", "FirstRule"]) {
    const graph = parseDot(fileLines(corpus(name, "graph.dot")));
    replay(name, graph);
    for (const bug of bugs(graph)) {
      paths[bug.rule.name] = [];
      for (const p of bug.path) paths[bug.rule.name].push(p.action);
    }
  }
  assert.deepEqual(paths.NotSolved, [
    "FillBig",
    "BigToSmall",
    "EmptySmall",
    "BigToSmall",
    "FillBig",
    "BigToSmall",
  ]);
  assert.deepEqual(paths.LoudWhenStopped, ["YouTurnItUp"]);
  assert.equal(paths.SignedInWhileLocked.length, 5);
  assert.equal(paths.TCConsistent.length, 5);
  assert.equal(paths.TCConsistent.at(-1), "RMRcvCommitMsg");
  assert.deepEqual(paths.NotOne, ["Next"]);
  assert.deepEqual(paths.NotOneOrThree, ["Next"]);
  assert.deepEqual(paths.AlsoNotOne, ["Next"]);
  assert.deepEqual(paths.NoDeadlock, ["Next", "Next", "Next"]);
});

test("a chart of only the bug paths words each one with the view, asked once for each state and step", () => {
  const spec = corpusSpec("FirstRule");
  const rules = stateRules(spec);
  const drawn = pathGraph(spec.variables);
  const paths: Bug[] = [];
  for (const f of fs.readdirSync(path.join(here, "corpus", "FirstRule")).sort()) {
    if (!/^verdict-\d+\.out$/.test(f)) continue;
    const messages = [...readMessages(fileLines(corpus("FirstRule", f)))];
    const { broke } = readVerdict(messages);
    for (const rule of rules)
      if (broke?.kind === rule.kind && (broke.kind === "deadlock" || rule.name === broke.name))
        paths.push(drawn.bug(rule, readCounterexample(messages)));
  }
  const asked: { [question: string]: number } = {};
  const count = (question: string) => (asked[question] = (asked[question] ?? 0) + 1);
  const view: View = {
    state: (v) => {
      count(`state ${v.x}`);
      return `x is ${v.x}`;
    },
    step: (action, from, to) => {
      count(`step ${from.x} to ${to.x}`);
      return `${action} adds one`;
    },
  };
  const { report: text, files } = compile(
    {
      spec: { ...spec, folder: "" },
      graph: drawn.graph,
      paths,
      rules: [],
      properties: [],
      exit: 1,
      stop: undefined,
      drawing: undefined,
      states: { distinct: 1234, initial: 1, complete: true, cut: false },
      messages: [],
    },
    checkView(view, inspect),
  );
  assert.match(
    text,
    /^TLC reached 1,234 states, more than the chart budget of 500, so the chart draws only the bug paths: 4 states and 3 arrows\.$/m,
  );
  assert.ok(files.has("chart.mmd"));
  for (const rule of ["NotOne", "NotOneOrThree", "AlsoNotOne"])
    assert.match(
      text,
      new RegExp(`^## ${rule} breaks\\n.*\\n0\\. x is 0\\n1\\. Next adds one: x is 1$`, "m"),
    );
  assert.deepEqual(asked, {
    "state 0": 1,
    "step 0 to 1": 1,
    "state 1": 1,
    "step 1 to 2": 1,
    "state 2": 1,
    "step 2 to 3": 1,
    "state 3": 1,
  });
});

test("TLC's marks place on their states even when TLC wraps them over lines", () => {
  const spec = corpusSpec("TwoPhase");
  const out = fs.readFileSync(corpus("TwoPhase", "ChartRun.out"), "utf8");
  const graph = parseDot(fs.readFileSync(corpus("TwoPhase", "graph.dot"), "utf8"));
  assert.equal(
    mark(graph, readMarks(readMessages(out), "chart"), spec.variables, stateRules(spec)).size,
    0,
  );
  const bad: Value[][] = [];
  for (const s of graph.states.values())
    if (s.breaks.length)
      bad.push([field(s.vars.rmState, "r1"), field(s.vars.rmState, "r2")].sort());
  assert.deepEqual(bad, [
    ["aborted", "committed"],
    ["aborted", "committed"],
  ]);
  const cut = out.slice(0, out.indexOf("{r1},"));
  assert.throws(
    () =>
      mark(
        parseDot(fs.readFileSync(corpus("TwoPhase", "graph.dot"), "utf8")),
        readMarks(readMessages(cut), "chart"),
        spec.variables,
        stateRules(spec),
      ),
    {
      message: `TLC's output ends inside a marked state, so the command cannot tell which rules it breaks:\n${cut.slice(cut.lastIndexOf('<< "chart",'))}\n`,
    },
  );
});

test("a chart tuple that TLC prints inside one of its messages is not a mark", () => {
  const chart = '<<"chart", <<2>>, {"Bad"}>>';
  const out = [
    chart,
    "@!@!@STARTMSG 2132:1 @!@!@",
    "The first argument of Assert evaluated to FALSE; the second argument was:",
    chart,
    "@!@!@ENDMSG 2132 @!@!@",
    "",
  ].join("\n");
  const marks = [...readMarks(readMessages(out), "chart")];
  assert.equal(marks.length, 1);
  assert.deepEqual(marks, [...readMarks(readMessages(`${chart}\n`), "chart")]);
});

test("a line that the spec prints in the shape of a mark is spec output, not a mark", () => {
  const out = [
    '<<"chart", <<2>>, {"Bad"}>>',
    '<< "chart-01234",',
    '   <<2>>, {"Bad"}>>',
    '<<"chart-012", 1>>',
    'x <<"chart-0123", <<2>>, {"Bad"}>>',
    '<< "chart-0123",',
    "   <<3>>,",
    '   {"Bad"} >>',
    "",
  ].join("\n");
  assert.deepEqual(
    [...readMarks(readMessages(out), "chart-0123")],
    [{ values: [3], broken: ["Bad"] }],
  );
});

const inv: Rule = { kind: "invariant", name: "Inv" };

test("a wrapped mark with a model value named constructor places on its state", () => {
  const graph = graphOf([["s0", { x: parseValue("constructor") }, true]], []);
  assert.equal(
    mark(
      graph,
      readMarks(readMessages('<<"chart",\n<<constructor>>,\n{"Inv"}>>\n'), "chart"),
      ["x"],
      [inv],
    ).size,
    0,
  );
  assert.deepEqual(graph.states.get("s0")?.breaks, [inv]);
});

test("a tagged line in the wrong shape is an error, not spec output", () => {
  for (const line of [
    '<<"chart", [x |-> 1, y |-> 2], {"Inv"}>>',
    '<<"chart", 1>>',
    '<<"chart", <<1>>, <<"Inv">>>>',
    '<<"chart", <<1>>, {1}>>',
    '<<"chart", <<1>>, {"Inv"}, 2>>',
  ])
    assert.throws(
      () => [...readMarks(readMessages(`${line}\n`), "chart")],
      /TLC printed a mark that the command cannot read/,
      line,
    );
});

const ab: View = { state: (v) => ({ A: `a${v.a}`, B: `b${v.b}` }) };
const bit = (v: Vars) => `${v.a}${v.b}${v.c}`;
const xorStates: StateRow[] = [];
const xorSteps: StepRow[] = [];
for (const a of [0, 1])
  for (const b of [0, 1])
    for (const c of [0, 1]) {
      const v = { a, b, c };
      xorStates.push([bit(v), v, a === 0]);
      if (a === 0 && b !== c) xorSteps.push([bit(v), bit({ ...v, a: 1 }), "Go"]);
      if (b === 0) xorSteps.push([bit(v), bit({ ...v, b: 1 }), "FlipB"]);
      if (c === 0) xorSteps.push([bit(v), bit({ ...v, c: 1 }), "FlipC"]);
    }
const truthGraphs: { [name: string]: [Graph, View] } = {
  starts: [
    graphOf(
      [
        ["x0y0", { x: 0, y: 0 }, true],
        ["x1y1", { x: 1, y: 1 }, true],
        ["x1y0", { x: 1, y: 0 }],
      ],
      [["x0y0", "x1y0", "Step"]],
    ),
    { state: (v) => ({ X: `x${v.x}`, Y: `y${v.y}` }) },
  ],
  xor: [
    graphOf(xorStates, xorSteps),
    { state: (v) => ({ A: `a${v.a}`, B: `b${v.b}`, C: `c${v.c}` }) },
  ],
  fork: [
    graphOf(
      [
        ["a0b0", { a: 0, b: 0 }, true],
        ["a1b1", { a: 1, b: 1 }],
        ["a2b2", { a: 2, b: 2 }],
      ],
      [
        ["a0b0", "a1b1", "Sync"],
        ["a0b0", "a2b2", "Sync"],
      ],
    ),
    ab,
  ],
  partial: [
    graphOf(
      [
        ["a0b0", { a: 0, b: 0 }, true],
        ["a1b1", { a: 1, b: 1 }],
        ["a1b0", { a: 1, b: 0 }],
      ],
      [
        ["a0b0", "a1b1", "Act"],
        ["a0b0", "a1b0", "Act"],
      ],
    ),
    ab,
  ],
  lockstep: [
    graphOf(
      [
        ["a0b0", { a: 0, b: 0 }, true],
        ["a1b1", { a: 1, b: 1 }],
      ],
      [["a0b0", "a1b1", "Act"]],
    ),
    ab,
  ],
  interleaved: [
    graphOf(
      [
        ["a0b0", { a: 0, b: 0 }, true],
        ["a1b0", { a: 1, b: 0 }],
        ["a0b1", { a: 0, b: 1 }],
        ["a1b1", { a: 1, b: 1 }],
      ],
      [
        ["a0b0", "a1b0", "Act"],
        ["a0b0", "a0b1", "Act"],
        ["a1b0", "a1b1", "Act"],
        ["a0b1", "a1b1", "Act"],
      ],
    ),
    ab,
  ],
};

for (const [name, regions] of [
  ["starts", false],
  ["xor", false],
  ["fork", false],
  ["partial", false],
  ["lockstep", true],
  ["interleaved", true],
] satisfies [string, boolean][]) {
  test(`${name}: the chart uses regions only when they show the model's moves exactly`, () => {
    const { chart, report: text } = draw(...truthGraphs[name]);
    assert.equal(chart.includes('state "At the same time"'), regions);
    assert.equal(/So the chart draws parent states in place of regions\.$/m.test(text), !regions);
  });
}

const forkToBug = graphOf(
  [
    ["a0b0", { a: 0, b: 0 }, true],
    ["a1b1", { a: 1, b: 1 }],
    ["a2b2", { a: 2, b: 2 }, false, ["Safe"]],
  ],
  [
    ["a0b0", "a1b1", "Sync"],
    ["a0b0", "a2b2", "Sync"],
  ],
);

test("a chart that draws parent states in place of regions still names each region in a bug path", () => {
  const { chart, report: text } = draw(forkToBug, ab);
  assert.match(chart, /^ {2}state "A a2" as s\d+ \{$/m);
  assert.match(text, /^0\. A a0, B b0\n1\. Sync: A a2, B b2$/m);
});

test("the view answers once for each state and step, so a chart of parent states agrees with its report", () => {
  const asked: { [question: string]: number } = {};
  const answer = (question: string) => {
    asked[question] = (asked[question] ?? 0) + 1;
    return asked[question] === 1 ? "first" : "later";
  };
  const { chart, report: text } = draw(forkToBug, {
    state: (v) => {
      const word = answer(`state ${v.a}`);
      return { A: `a${v.a} ${word}`, B: `b${v.b}` };
    },
    step: (action, from, to) => `${action} ${answer(`step ${from.a} to ${to.a}`)}`,
    group: (v) => (answer(`group ${v.a}`) === "first" ? "Calm" : "Busy"),
    colors: { Calm: "blue", Busy: "orange" },
  });
  assert.match(chart, /^ {2}state "A a2 first" as s\d+ \{$/m);
  assert.doesNotMatch(chart, /later|orange/);
  assert.match(text, /^0\. A a0 first, B b0\n1\. Sync first: A a2 first, B b2$/m);
  assert.deepEqual(asked, {
    "state 0": 1,
    "state 1": 1,
    "state 2": 1,
    "step 0 to 1": 1,
    "step 0 to 2": 1,
    "group 0": 1,
    "group 1": 1,
    "group 2": 1,
  });
});

test("a region state is marked when every combination with it can break a rule", () => {
  const graph = graphOf(
    [
      ["a0b0", { a: 0, b: 0 }, true],
      ["a1b0", { a: 1, b: 0 }],
      ["a2b0", { a: 2, b: 0 }, false, ["Safe"]],
      ["a2b1", { a: 2, b: 1 }, false, ["Safe"]],
      ["a0b1", { a: 0, b: 1 }],
    ],
    [
      ["a0b0", "a1b0", "Go"],
      ["a1b0", "a2b0", "Go"],
      ["a2b0", "a2b1", "Flip"],
      ["a0b0", "a0b1", "Flip"],
    ],
  );
  assert.deepEqual(marked(draw(graph, ab).chart), { a2: "breaks" });
});

test("a combination that breaks a rule marks its states when no state of it has a mark", () => {
  const graph = graphOf(
    [
      ["a0b0", { a: 0, b: 0 }, true],
      ["a1b0", { a: 1, b: 0 }],
      ["a0b1", { a: 0, b: 1 }],
      ["a1b1", { a: 1, b: 1 }, false, ["Safe"]],
    ],
    [
      ["a0b0", "a1b0", "GoA"],
      ["a0b0", "a0b1", "GoB"],
      ["a1b0", "a1b1", "GoB"],
      ["a0b1", "a1b1", "GoA"],
    ],
  );
  assert.deepEqual(marked(draw(graph, ab).chart), { a1: "mayBreak", b1: "mayBreak" });
});

test("a bug-path step that stays in one state is a loop in a flat chart only", () => {
  const graph = graphOf(
    [
      ["s0", { x: 0, y: 0 }, true],
      ["s1", { x: 0, y: 1 }, false, ["Safe"]],
      ["s2", { x: 1, y: 0 }],
    ],
    [
      ["s0", "s1", "Tick"],
      ["s0", "s2", "Move"],
    ],
  );
  const flat = draw(graph, { state: (v) => `x${v.x}` });
  assert.match(flat.chart, /^ {2}(s\d+) --> \1: Tick$/m);
  assert.doesNotMatch(flat.report, /does not draw/);
  const regions = draw(graph, { state: (v) => ({ X: `x${v.x}`, Z: "z" }) });
  assert.doesNotMatch(regions.chart, /Tick/);
  assert.match(regions.report, /^The chart does not draw 1 steps that stay in one chart state\.$/m);
});

test("a step that leaves every child of a parent the same way is one arrow from the parent", () => {
  const graph = graphOf(
    [
      ["x", { at: "Open.x" }, true],
      ["y", { at: "Open.y" }],
      ["done", { at: "Closed" }],
    ],
    [
      ["x", "y", "Next"],
      ["x", "done", "Quit"],
      ["y", "done", "Quit"],
    ],
  );
  const { chart } = draw(graph, { state: (v) => String(v.at).split(".") });
  const open = chart.match(/^ {2}state "Open" as (s\d+) \{$/m)?.[1];
  const closed = chart.match(/^ {2}(s\d+): Closed$/m)?.[1];
  const quits = [];
  for (const m of chart.matchAll(/^ {2}(s\d+) --> (s\d+): Quit$/gm)) quits.push([m[1], m[2]]);
  assert.deepEqual(quits, [[open, closed]]);
});

test("a view that cannot give a chart says what to change", () => {
  const graph = graphOf(
    [
      ["p", { x: "A" }, true],
      ["q", { x: "A.B" }],
    ],
    [["p", "q", "Go"]],
  );
  assert.throws(
    () => draw(graph, { state: (v) => String(v.x).split(".") }),
    /both as a state and as a parent state/,
  );
  assert.throws(
    () => draw(graph, { state: (v) => (v.x === "A" ? { R: "x" } : { S: "y" }) }),
    /Return the same regions for every state/,
  );
  assert.throws(() => draw(graph, { state: () => [] }), /Return a string, an array of strings/);
});

const keyGraph = () =>
  graphOf(
    [
      ["idle", { pos: "idle", key: parseValue("[on |-> FALSE, at |-> 0]") }, true],
      ["waitKeyOff", { pos: "wait", key: parseValue("[on |-> FALSE, at |-> 0]") }],
      ["waitKeyOn", { pos: "wait", key: parseValue("[on |-> TRUE, at |-> 0]") }],
      ["done", { pos: "done", key: parseValue("[on |-> TRUE, at |-> 0]") }],
    ],
    [
      ["idle", "waitKeyOff", "Go"],
      ["idle", "waitKeyOn", "GoKey"],
      ["waitKeyOff", "waitKeyOff", "Tick"],
      ["waitKeyOff", "idle", "Back"],
      ["waitKeyOn", "done", "Open"],
    ],
  );
const keyState = (header: string, pos: string) => ({
  code: EC.TLC_STATE_PRINT2,
  level: LEVEL.STATE,
  body: [header, `/\\ pos = "${pos}"`, "/\\ key = [at |-> 0, on |-> FALSE]", ""],
});
const keyTrace = () =>
  readTrace([
    keyState("1: <Initial predicate>", "idle"),
    keyState("2: <Go line 9, col 3 to line 9, col 20 of module Key>", "wait"),
    { code: EC.TLC_STATE_PRINT3, level: LEVEL.STATE, body: ["3: Stuttering"] },
  ]);

test("a loop's trace finds its states when TLC prints record fields in another order", () => {
  const graph = keyGraph();
  const bug = lasso(graph, keyTrace(), ["pos", "key"]);
  assert.ok(bug);
  assert.equal(bug.start, "idle");
  const moves = [];
  for (const p of bug.path) moves.push([p.action, p.state]);
  assert.deepEqual(moves, [["Go", "waitKeyOff"]]);
  assert.equal(bug.loop, 1);
  assert.equal(bug.stutters, true);
});

test("a view may hide a step inside a loop, but not a step out of it", () => {
  const graph = keyGraph();
  const found = lasso(graph, keyTrace(), ["pos", "key"]);
  assert.ok(found);
  const loop: Bug = { rule: { kind: "property", name: "Opens" }, ...found };
  const state = (v: Vars) => `${v.pos}, key ${field(v.key, "on") ? "on" : "off"}`;
  const { report } = draw(graph, { state, step: (a) => (a === "Tick" ? null : a) }, [loop]);
  assert.match(report, /^The run stops in "wait, key off" forever\.$/m);
  assert.throws(
    () => draw(graph, { state, step: (a) => (a === "Back" ? null : a) }, [loop]),
    /the step Back that changes pos\. It is on the path to the Opens bug or leaves its loop/,
  );
});

test("a chart that draws a way out of a loop that the loop cannot take stops the command", () => {
  const graph = keyGraph();
  const found = lasso(graph, keyTrace(), ["pos", "key"]);
  assert.ok(found);
  const loop: Bug = { rule: { kind: "property", name: "Opens" }, ...found };
  assert.throws(
    () => draw(graph, { state: (v) => v.pos }, [loop]),
    /draws the step Open out of wait, but the Opens loop cannot take it there/,
  );
  const { chart } = draw(
    graph,
    { state: (v) => `${v.pos}, key ${field(v.key, "on") ? "on" : "off"}` },
    [loop],
  );
  const wait = chart.match(/^ {2}(s\d+): wait, key off$/m)?.[1];
  assert.match(chart, new RegExp(`^ {2}class ${wait} repeats$`, "m"));
});

test("a region named __proto__ is a region like any other", () => {
  const graph = graphOf(
    [
      ["s0", { x: 0, y: 0 }, true],
      ["s1", { x: 1, y: 0 }],
      ["s2", { x: 0, y: 1 }],
    ],
    [
      ["s0", "s1", "GoX"],
      ["s0", "s2", "GoY"],
    ],
  );
  const { chart } = draw(graph, {
    state: (v): unknown => JSON.parse(`{"__proto__": "X${v.x}", "Other": "Y${v.y}"}`),
  });
  assert.match(chart, /^ {4}state "#95;#95;proto#95;#95;" as r0 \{$/m);
  assert.match(chart, /^ {6}s0 --> s1: GoX \[when Y0\]$/m);
  assert.match(chart, /^ {4}state "Other" as r1 \{$/m);
});

test("checkView takes a full view and refuses each wrong kind and every bad color", () => {
  checkView({}, inspect);
  checkView(
    {
      state: (v: Vars) => v.x,
      step: (a: string) => a,
      group: () => "Busy",
      colors: { Busy: "blue" },
      title: "T",
    },
    inspect,
  );
  assert.throws(() => checkView({ colors: null }, inspect), /\bcolors\b[\s\S]*\bobject\b/);
  assert.throws(() => checkView({ colors: ["blue"] }, inspect), /\bcolors\b[\s\S]*\bobject\b/);
  assert.throws(() => checkView({ state: "Busy" }, inspect), /\bstate\b[\s\S]*\bfunction\b/);
  assert.throws(
    () => checkView({ colors: { Busy: "red", Idle: "repeats", Done: "tan" } }, inspect),
    (error: unknown) =>
      error instanceof Error &&
      /\bBusy\b[\s\S]*"red"/.test(error.message) &&
      /\bIdle\b[\s\S]*"repeats"/.test(error.message) &&
      !/\bDone\b/.test(error.message),
  );
});

test("a group named like an Object method still needs its own color", () => {
  const graph = graphOf([["s0", { x: 0 }, true]], []);
  assert.throws(
    () => draw(graph, checkView({ group: () => "toString", colors: {} }, inspect)),
    /group\(\) returned "toString"/,
  );
});

test("checkView takes colors only as a plain object", () => {
  const bare: object = Object.create(null);
  checkView({ colors: Object.assign(bare, { Busy: "blue" }) }, inspect);
  const inherited: object = Object.create({ Busy: "blue" });
  for (const colors of [new Map([["Busy", "blue"]]), inherited, new String("blue")])
    assert.throws(() => checkView({ colors }, inspect), {
      message: "The view's colors must be a plain object.",
    });
});

test("the chart uses the colors that checkView read once from the view's own keys", () => {
  const graph = graphOf([["s0", { x: 0 }, true]], []);
  let reads = 0;
  const flips = {
    get Busy() {
      reads += 1;
      return reads === 1 ? "blue" : "breaks";
    },
  };
  const changed = { Busy: "blue" };
  const changes = () => {
    changed.Busy = "breaks";
    return "Busy";
  };
  for (const view of [
    { group: () => "Busy", colors: flips },
    { group: changes, colors: changed },
  ]) {
    const { chart } = draw(graph, checkView(view, inspect));
    assert.match(chart, /^ {2}class s\d+ blue$/m);
    assert.doesNotMatch(chart, /\bbreaks\b/);
  }
  const hidden = Object.defineProperty({}, "Busy", { value: "breaks" });
  assert.throws(
    () => draw(graph, checkView({ group: () => "Busy", colors: hidden }, inspect)),
    /group\(\) returned "Busy", which colors does not name/,
  );
  const key = Symbol("Busy");
  assert.throws(
    () => draw(graph, checkView({ group: () => key, colors: { [key]: "breaks" } }, inspect)),
    /group\(\) returned Symbol\(Busy\), which colors does not name/,
  );
});

test("a graph of 10,000 states preserves the shortest bug path with no view", () => {
  const n = 100;
  const states: StateRow[] = [];
  const steps: StepRow[] = [];
  for (let x = 0; x < n; x++)
    for (let y = 0; y < n; y++) {
      const far = x === n - 1 && y === n - 1;
      states.push([`${x},${y}`, { x, y }, x + y === 0, far ? ["Safe"] : []]);
      if (x + 1 < n) steps.push([`${x},${y}`, `${x + 1},${y}`, "Right"]);
      if (y + 1 < n) steps.push([`${x},${y}`, `${x},${y + 1}`, "Down"]);
    }
  const { chart, report: text } = draw(graphOf(states, steps), {});
  assert.match(text, /^The shortest path has 198 steps:$/m);
  assert.equal(chart.match(/^ {2}s\d+: /gm)?.length, n * n);
});
