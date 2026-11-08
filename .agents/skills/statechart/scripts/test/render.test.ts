import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fuzz, type Html, type Mermaid, type Render } from "./labels.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const charts = [];
for (const f of fs.readdirSync(path.join(here, "charts")))
  charts.push(path.join(here, "charts", f));
for (const d of fs.readdirSync(path.join(here, "corpus")))
  charts.push(path.join(here, "corpus", d, "chart.mmd"));
const dependencies = createRequire(import.meta.url);

let render: Render;
let mermaid: Mermaid;
let html: Html;
before(async () => {
  ({ render } = await import(pathToFileURL(dependencies.resolve("pele")).href));

  const { window } = new (dependencies("jsdom").JSDOM)("");
  Object.assign(globalThis, { window, document: window.document, DOMParser: window.DOMParser });
  mermaid = (await import(pathToFileURL(dependencies.resolve("mermaid")).href)).default;
  html = (markup) => {
    const t = window.document.createElement("template");
    t.innerHTML = markup;
    return t.content.textContent ?? "";
  };
});

for (const chart of charts) {
  const name = path.relative(here, chart);
  const text = fs.readFileSync(chart, "utf8");
  test(`${name} parses in mermaid.js, which chat views use`, async () => {
    await mermaid.parse(text);
  });
}

test("random labels and colors keep their text and the chart's shape in Mermaid and Pele", async () => {
  const { drawn, refused, failure } = await fuzz({ seed: 1, charts: 500, render, mermaid, html });
  if (failure) assert.fail(failure);
  assert.ok(drawn > 400 && refused > 20, `${drawn} charts drawn, ${refused} refused`);
});
