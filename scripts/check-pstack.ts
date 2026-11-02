import assert from "node:assert/strict";
import { existsSync, globSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

const root = path.resolve(import.meta.dirname, "..");
const canonical = path.join(root, ".agents/skills");
const lock = z
  .object({
    skills: z.record(z.string(), z.object({ source: z.string() }).loose()),
  })
  .parse(
    JSON.parse(readFileSync(path.join(root, "skills-lock.json"), "utf-8"))
  );
const skills = Object.entries(lock.skills)
  .filter(([, entry]) => entry.source === "backnotprop/pstack")
  .map(([name, entry]) => ({
    name,
    ...z
      .object({
        ref: z.string().regex(/^[a-f0-9]{40}$/u),
        skillPath: z.string(),
      })
      .parse(entry),
  }));
assert.ok(skills.length > 0, "No pstack skills recorded in skills-lock.json.");
assert.equal(
  new Set(skills.map((entry) => entry.ref)).size,
  1,
  "Pstack revisions differ."
);

for (const client of [".claude", ".opencode"]) {
  assert.equal(
    realpathSync(path.join(root, client, "skills")),
    canonical,
    `${client} must load the canonical skills.`
  );
}
assert.match(
  readFileSync(path.join(root, "CLAUDE.md"), "utf-8"),
  /^@AGENTS\.md$/mu
);

for (const entry of skills) {
  const { name } = entry;
  assert.equal(entry.skillPath, `skills/${name}/SKILL.md`);
  const directory = path.join(canonical, name);
  const text = readFileSync(path.join(directory, "SKILL.md"), "utf-8");
  const frontmatter = /^---\r?\n(?<yaml>[\s\S]*?)\r?\n---\r?\n/u.exec(text);
  assert.ok(frontmatter, `${name} is missing frontmatter.`);
  const metadata = z
    .object({ description: z.string().min(1), name: z.string() })
    .parse(parse(frontmatter.groups?.yaml ?? ""));
  assert.equal(metadata.name, name, `${name} has the wrong skill name.`);
  assert.ok(
    metadata.description.trim().length > 0,
    `${name} needs a description.`
  );

  for (const relative of globSync("**/*.md", {
    cwd: directory,
    exclude: ["**/node_modules/**"],
  })) {
    const absolute = path.join(directory, relative);
    const markdown = readFileSync(absolute, "utf-8").replaceAll(
      /^(?<fence>`{3,}|~{3,})[^\n]*\n[\s\S]*?^\k<fence>[^\n]*$/gmu,
      ""
    );
    for (const match of markdown.matchAll(
      /\[[^\]]*\]\((?<target>[^\s)]+)(?:\s+"[^"]*")?\)/gu
    )) {
      const target = match.groups?.target;
      assert.ok(target);
      if (target === "url" || /^[a-z][a-z\d+.-]*:|^#|[<>]/iu.test(target)) {
        continue;
      }
      const linkedPath = decodeURIComponent(target.split("#")[0] ?? "");
      assert.ok(
        existsSync(path.resolve(path.dirname(absolute), linkedPath)),
        `${absolute} links to missing ${target}.`
      );
    }
  }
}

for (const name of ["bootstrap.ts", "bun.lock"]) {
  assert.ok(
    !existsSync(path.join(canonical, "poteto-mode/scripts", name)),
    `${name} bypasses the workspace dependency lock.`
  );
}
for (const relative of [
  "poteto-mode/scripts/orch/orch.ts",
  "poteto-mode/scripts/watch-pr/watch-pr",
]) {
  assert.doesNotMatch(
    readFileSync(path.join(canonical, relative), "utf-8"),
    /ensureDependenciesInstalled/u
  );
}
assert.doesNotMatch(
  readFileSync(
    path.join(canonical, "statechart/scripts/test/render.test.ts"),
    "utf-8"
  ),
  /execFileSync\(\s*"npm"/u
);
const workspace = readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf-8");
for (const name of ["poteto-mode", "statechart"]) {
  assert.ok(
    workspace.includes(`.agents/skills/${name}/scripts`),
    `${name} tools are missing from the workspace.`
  );
}
process.stdout.write(
  `Verified ${skills.length} pstack skills, local links, native discovery paths, and workspace tool bindings.\n`
);
