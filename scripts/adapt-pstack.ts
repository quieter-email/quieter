import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { z } from "zod";

const root = path.resolve(import.meta.dirname, "..");
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
const refs = new Set(skills.map((entry) => entry.ref));
assert.equal(
  refs.size,
  1,
  "Install one reviewed pstack revision before adapting it."
);
const [ref] = refs;
assert.ok(ref);

for (const { name } of skills) {
  const file = path.join(root, ".agents/skills", name, "SKILL.md");
  let text = readFileSync(file, "utf-8");
  text = text.replaceAll(
    /\]\(\.\.\/\.\.\/(?<document>README\.md|docs\/[^)]+)\)/gu,
    `](https://github.com/backnotprop/pstack/blob/${ref}/$<document>)`
  );
  text = text.replaceAll(
    /https:\/\/github\.com\/backnotprop\/pstack\/blob\/[a-f0-9]{40}\//gu,
    `https://github.com/backnotprop/pstack/blob/${ref}/`
  );
  if (
    /Task|subagent|AskQuestion|agent-transcripts|pstack-models|cursor-team-kit|\.cursor\/|control-ui|control-cli|\/loop/u.test(
      text
    )
  ) {
    const adapter =
      "Read [the client adapter](../../pstack/harnesses.md) before applying tool, model, transcript, or permission instructions. It overrides the Cursor-specific defaults below.";
    if (!text.includes(adapter)) {
      text = text.replace(/^(?<title># [^\n]+\n)/mu, `$<title>\n${adapter}\n`);
    }
  }
  if (name === "poteto-mode") {
    text = text.replace(
      /## Harness\n[\s\S]*?(?=\n## Writing the reply)/u,
      "## Harness\n\nFollow [the client adapter](../../pstack/harnesses.md) for Codex, Claude Code, OpenCode Go, Cursor, and Pi. It owns native discovery, delegation, model settings, session access, and optional-tool replacements. Repository policy and the active tool schema take precedence.\n"
    );
  }
  if (name === "setup-pstack") {
    const route =
      "In Codex, Claude Code, or OpenCode, follow [the native setup steps](../../pstack/setup.md) instead of the Cursor-specific steps below.";
    if (!text.includes(route)) {
      text = text.replace("# Setup pstack\n", `# Setup pstack\n\n${route}\n`);
    }
  }
  if (name === "recall") {
    text = text.replace(
      "**OpenCode:** `~/.local/share/opencode/storage/`. Sessions are JSON files under `session/<project-id>/`, with their messages under `message/` and `part/`.",
      "**OpenCode:** use `opencode session list` and `opencode export <session-id>`, scoped to the active workspace. Follow the client adapter for version-dependent storage."
    );
    text = text.replace(
      "Each file is JSONL.",
      "Transcript formats depend on the client."
    );
  }
  if (name === "poteto-help") {
    text = text.replace(
      "through `npx skills add backnotprop/pstack`",
      "through the tracked installation described in `docs/pstack.md`"
    );
  }
  writeFileSync(file, text);
}

const plan = path.join(
  root,
  ".agents/skills/poteto-mode/playbooks/multi-phase-plan.md"
);
writeFileSync(
  plan,
  readFileSync(plan, "utf-8")
    .replaceAll("pstack/skills/", ".agents/skills/")
    .replaceAll(
      /\b(?:vp (?:exec )?)?node \.agents\/skills\/poteto-mode\/scripts\/check-plan\.mjs/gu,
      "vp exec node .agents/skills/poteto-mode/scripts/check-plan.mjs"
    )
);

for (const relative of ["orch/orch.ts", "watch-pr/watch-pr"]) {
  const file = path.join(root, ".agents/skills/poteto-mode/scripts", relative);
  const text = readFileSync(file, "utf-8")
    .replace(
      /^import \{ ensureDependenciesInstalled \} from "\.\.\/bootstrap\.ts";\n/mu,
      ""
    )
    .replace(/^ensureDependenciesInstalled\(\);\n/mu, "");
  writeFileSync(file, text);
  chmodSync(file, 0o755);
}
for (const name of ["bootstrap.ts", "bun.lock"]) {
  rmSync(path.join(root, ".agents/skills/poteto-mode/scripts", name), {
    force: true,
  });
}

const auditFile = path.join(
  root,
  ".agents/skills/poteto-mode/scripts/worktree-audit.sh"
);
let audit = readFileSync(auditFile, "utf-8");
audit = audit
  .replaceAll("stat_fmt=(-c '%Y %n')", "stat_fmt=(-c '%Y')")
  .replaceAll("stat_fmt=(-f '%m %N')", "stat_fmt=(-f '%m')");
audit = audit
  .replaceAll(
    "awk '/^worktree /{print $2; exit}'",
    "sed -n 's/^worktree //p' | head -1"
  )
  .replaceAll("awk '/^worktree /{print $2}'", "sed -n 's/^worktree //p'");
audit = audit
  .replaceAll('rg -l -e "', 'rg -l -0 -F -e "')
  .replaceAll("xargs stat ", "xargs -0 stat ");
audit = audit.replace(
  "last_ts=$(echo \"$f\" | awk '{print $1}')",
  'last_ts="$f"'
);
if (!audit.includes("verify-chat-history")) {
  audit = audit.replace(
    'elif [ "$merged" = YES ] || [ "$pr" != "-" ]; then bucket=safe',
    `elif [ -d "\${CODEX_HOME:-$HOME/.codex}/sessions" ] || [ -d "\${XDG_DATA_HOME:-$HOME/.local/share}/opencode" ]; then\n\t\t\t\tlast="unavailable"; bucket=verify-chat-history\n\t\t\telif [ "$merged" = YES ] || [ "$pr" != "-" ]; then bucket=safe`
  );
}
writeFileSync(auditFile, audit);
chmodSync(auditFile, 0o755);

const renderFile = path.join(
  root,
  ".agents/skills/statechart/scripts/test/render.test.ts"
);
let render = readFileSync(renderFile, "utf-8");
render = render
  .replace('import { execFileSync } from "node:child_process";\n', "")
  .replace('import os from "node:os";\n', "");
render = render.replace(
  /const cache = path\.join\([\s\S]*?(?=\nlet render: Render;)/u,
  "const dependencies = createRequire(import.meta.url);\n"
);
render = render.replace(
  '  const pele = install("test-pele-1.9.0", "pele@1.9.0");\n  ({ render } = await import(pathToFileURL(pele.resolve("pele")).href));',
  '  ({ render } = await import(pathToFileURL(dependencies.resolve("pele")).href));'
);
render = render
  .replace(
    '  const parser = install("test-mermaid-11.16.0", "mermaid@11.16.0", "jsdom@26.1.0");\n  const { window } = new (parser("jsdom").JSDOM)("");',
    '  const { window } = new (dependencies("jsdom").JSDOM)("");'
  )
  .replace('parser.resolve("mermaid")', 'dependencies.resolve("mermaid")');
writeFileSync(renderFile, render);
const statePackage = path.join(
  root,
  ".agents/skills/statechart/scripts/package.json"
);
const state = z
  .object({
    devDependencies: z.record(z.string(), z.string()),
    scripts: z.record(z.string(), z.string()),
  })
  .loose()
  .parse(JSON.parse(readFileSync(statePackage, "utf-8")));
state.scripts.test =
  "node --disable-warning=ExperimentalWarning --test test/*.test.ts";
state.devDependencies = {
  ...state.devDependencies,
  jsdom: "26.1.0",
  mermaid: "11.16.0",
  pele: "1.9.0",
};
writeFileSync(statePackage, `${JSON.stringify(state, null, 2)}\n`);

for (const client of [".claude", ".opencode"]) {
  const directory = path.join(root, client);
  mkdirSync(directory, { recursive: true });
  const link = path.join(directory, "skills");
  if (existsSync(link)) {
    assert.equal(
      readlinkSync(link),
      "../.agents/skills",
      `Preserve existing ${client} skills before creating a shared link.`
    );
  } else {
    symlinkSync("../.agents/skills", link, "dir");
  }
}

process.stdout.write(`Adapted ${skills.length} pstack skills at ${ref}.\n`);
