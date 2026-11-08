import assert from "node:assert/strict";
import { test } from "node:test";
import { inspect } from "node:util";
import { checkView } from "../frontends/view.ts";
import {
  type CheckResult,
  EC,
  LEVEL,
  type Rule,
  type Spec,
  stateRules,
  type Verdict,
} from "../ir.ts";
import { compile } from "../pipeline.ts";

const small: Rule = { kind: "invariant", name: "Small" };

const noView = checkView({}, inspect);

const holding = (spec: Spec) => {
  const verdicts: Verdict[] = [];
  for (const rule of stateRules(spec))
    verdicts.push({ rule, outcome: "holds", messages: undefined });
  return verdicts;
};

const twoStates = (breaks: Rule[], property = "Settles"): CheckResult => ({
  spec: {
    module: "Two",
    variables: ["x"],
    invariants: ["Small"],
    properties: [property],
    deadlock: false,
    written: [],
    folder: "",
  },
  paths: undefined,
  graph: {
    states: new Map([
      ["1", { vars: { x: 0 }, start: true, breaks: [] }],
      ["2", { vars: { x: 1 }, start: false, breaks }],
    ]),
    steps: [{ from: "1", to: "2", action: "Grow" }],
  },
  rules: [{ rule: small, outcome: breaks.length ? "broken" : "holds", messages: undefined }],
  properties: [
    {
      rule: { kind: "property", name: property },
      outcome: breaks.length ? "broken" : "holds",
      messages: [
        {
          code: EC.TLC_STATE_PRINT2,
          level: LEVEL.STATE,
          body: ["1: <Initial predicate>", "x = 0"],
        },
      ],
      bug: undefined,
      initialOnly: false,
    },
  ],
  exit: breaks.length ? 1 : 0,
  stop: undefined,
  drawing: undefined,
  states: { distinct: 2, initial: 1, complete: true, cut: false },
  messages: [{ code: EC.TLC_FINISHED, level: LEVEL.NONE, body: ["Finished in 394ms at (T)"] }],
});

const body = (files: Map<string, Iterable<string | Uint8Array>>, name: string) => {
  let text = "";
  for (const part of files.get(name) ?? [])
    text += typeof part === "string" ? part : new TextDecoder().decode(part);
  return text;
};

test("an invariant and a property with one name stay two rules", () => {
  const reportWithSmallProperty = (breaks: Rule[]) => {
    const result = twoStates(breaks);
    const step = result.graph.steps[0];
    result.spec.properties = ["Small"];
    result.properties = [
      {
        rule: { kind: "property", name: "Small" },
        outcome: "broken",
        messages: [],
        bug: { start: "1", path: [{ action: "Grow", state: "2", step }], loop: 1, stutters: true },
        initialOnly: false,
      },
    ];
    return compile(result, noView).report;
  };
  const both = reportWithSmallProperty([small]);
  assert.match(both, /^## Small breaks\nThe shortest path has 1 step:$/m);
  assert.match(
    both,
    /^## Small breaks\nTLC's counterexample is in tlc-Small\.out\. It has 1 step:$/m,
  );
  assert.match(reportWithSmallProperty([]), /^## Rules that hold\nSmall$/m);
});

test("a PROPERTY that breaks with no path writes TLC's counterexample", () => {
  const result = twoStates([]);
  result.properties[0].outcome = "broken";
  const { report, files } = compile(result, noView);
  assert.match(
    report,
    /^## Settles breaks\nTLC found a counterexample\. It is in tlc-Settles\.out\.$/m,
  );
  assert.equal(body(files, "tlc-Settles.out"), "State 1: <Initial predicate>\nx = 0\n");
});

test("a rule named NoDeadlock leaves the deadlock rule a name of its own", () => {
  const holds = (result: CheckResult) => {
    result.spec.deadlock = true;
    result.rules = holding(result.spec);
    return compile(result, noView).report.match(/^## Rules that hold\n(.*)$/m)?.[1];
  };
  const invariant = twoStates([]);
  invariant.spec.invariants = ["NoDeadlock"];
  assert.equal(holds(invariant), "NoDeadlock, CHECK_DEADLOCK, Settles");
  assert.equal(holds(twoStates([], "NoDeadlock")), "Small, CHECK_DEADLOCK, NoDeadlock");
  assert.equal(holds(twoStates([])), "Small, NoDeadlock, Settles");
});

test("a run that does not check for deadlock never names CHECK_DEADLOCK", () => {
  const invariant = twoStates([]);
  invariant.spec.invariants = ["Small", "NoDeadlock"];
  for (const result of [invariant, twoStates([], "NoDeadlock")]) {
    result.rules = holding(result.spec);
    assert.doesNotMatch(compile(result, noView).report, /CHECK_DEADLOCK/);
  }
});
