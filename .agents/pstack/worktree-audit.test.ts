import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

const audit = path.resolve(import.meta.dirname, "../skills/poteto-mode/scripts/worktree-audit.sh");

function fixture(context: TestContext) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pstack audit-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const repo = path.join(directory, "repo");
  const worktree = path.join(directory, "work[1] tree");
  const home = path.join(directory, "home");
  const bin = path.join(directory, "bin");
  mkdirSync(bin);
  mkdirSync(home);
  for (const command of ["origin", "gh"]) {
    writeFileSync(path.join(bin, command), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  }
  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: path.join(home, ".codex"),
    XDG_DATA_HOME: path.join(home, ".local/share"),
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
  };
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", repo], { env });
  execFileSync("git", ["-C", repo, "-c", "user.name=Pstack test", "-c", "user.email=pstack@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "fixture"], { env });
  execFileSync("git", ["-C", repo, "worktree", "add", "--quiet", "--detach", worktree], { env });
  return { directory, repo, worktree, home, env };
}

test("recent chat matching preserves spaces and treats worktree paths literally", (context) => {
  const { directory, repo, worktree, home, env } = fixture(context);
  const sibling = path.join(directory, "work1 tree");
  execFileSync("git", ["-C", repo, "worktree", "add", "--quiet", "--detach", sibling], { env });
  const transcripts = path.join(home, ".claude/projects", repo.replaceAll(/[^A-Za-z0-9]/gu, "-"));
  mkdirSync(transcripts, { recursive: true });
  writeFileSync(path.join(transcripts, "session with spaces.jsonl"), JSON.stringify({ cwd: worktree }));

  const output = execFileSync("bash", [audit, "--base", "main", repo], { env, encoding: "utf8" });
  const recent = output.split("\n").find((line) => line.endsWith(`\t${worktree}`));
  const inactive = output.split("\n").find((line) => line.endsWith(`\t${sibling}`));
  assert.ok(recent);
  assert.ok(inactive);
  assert.match(recent, /\tverify-recent-chat\t/u);
  assert.match(inactive, /\tsafe\t/u);
});

for (const client of [".codex/sessions", ".local/share/opencode"]) {
  test(`unread ${client} history prevents an automatic safe cleanup verdict`, (context) => {
    const { repo, worktree, home, env } = fixture(context);
    mkdirSync(path.join(home, client), { recursive: true });

    const output = execFileSync("bash", [audit, "--base", "main", repo], { env, encoding: "utf8" });
    const row = output.split("\n").find((line) => line.endsWith(`\t${worktree}`));
    assert.ok(row);
    assert.match(row, /\tunavailable\tverify-chat-history\t/u);
  });
}
