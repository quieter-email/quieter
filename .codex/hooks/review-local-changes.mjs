import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
let stdin = "";

for await (const chunk of process.stdin) {
  stdin += chunk;
}

const input = JSON.parse(stdin);
const mode = process.argv[2];

async function git(args, encoding = "utf8") {
  return (
    await execFileAsync("git", args, {
      cwd: input.cwd,
      encoding,
      maxBuffer: 100 * 1024 * 1024,
      windowsHide: true,
    })
  ).stdout;
}

async function fingerprint() {
  const hash = createHash("sha256");
  hash.update(await git(["diff", "--binary", "--no-ext-diff", "HEAD", "--"], "buffer"));

  const root = (await git(["rev-parse", "--show-toplevel"])).trim();
  const untracked = await git(["ls-files", "--others", "--exclude-standard", "-z"]);

  for (const path of untracked.split("\0").filter(Boolean)) {
    const absolutePath = `${root}/${path}`;
    const stats = await lstat(absolutePath);
    hash.update(path);
    hash.update("\0");

    if (stats.isSymbolicLink()) {
      hash.update(await readlink(absolutePath));
    } else {
      for await (const chunk of createReadStream(absolutePath)) {
        hash.update(chunk);
      }
    }

    hash.update("\0");
  }

  return hash.digest("hex");
}

function respond(output = {}) {
  process.stdout.write(JSON.stringify(output));
}

try {
  const stateDirectory = (
    await git(["rev-parse", "--path-format=absolute", "--git-path", "codex-hooks"])
  ).trim();
  const sessionId = input.session_id.replaceAll(/[^a-zA-Z0-9_.-]/g, "_");
  const statePath = `${stateDirectory}/review-local-changes-${sessionId}.json`;

  if (mode === "snapshot") {
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(statePath, JSON.stringify({ fingerprint: await fingerprint() }), "utf8");
    respond();
  } else if (mode === "review") {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    await rm(statePath, { force: true });

    if (input.stop_hook_active || state.fingerprint === (await fingerprint())) {
      respond();
    } else {
      respond({
        decision: "block",
        reason: [
          "Before finishing, review the complete local diff for the implementation changed during this turn.",
          "Read and follow every applicable AGENTS.md.",
          "Check that repository boundaries, product invariants, and established patterns are preserved.",
          "Make the code the cleanest minimal shape: remove obsolete paths and duplicate logic; avoid unnecessary abstractions, single-use helpers, excessive destructuring, one-line wrappers, unnecessary type guards, impossible-case branches, speculative fallbacks, and defensive checks that do not protect a real boundary.",
          "Look for concrete bugs and regressions, including state isolation, cache/query-key mistakes, stale or racing async behavior, error handling, security and privacy risks, performance traps, and future maintenance footguns.",
          "For user-facing changes, check accessibility, keyboard behavior, focus management, labels, semantics, loading and error states, and consistency with the existing layout and shared UI components.",
          "Fix issues that are supported by the diff and stay within the task's scope. Preserve unrelated user changes and avoid speculative refactors.",
          "Add or adjust focused tests when behavior changed, then run the verification required by AGENTS.md where feasible.",
          "If the review finds no issue, finish with a concise assessment instead of changing code for its own sake.",
        ].join(" "),
      });
    }
  } else {
    throw new Error(`Unknown hook mode: ${mode}`);
  }
} catch (error) {
  if (error?.code === "ENOENT" && mode === "review") {
    respond({
      decision: "block",
      reason:
        "Snapshot state file is missing — unable to verify the working tree is unchanged. Review the complete local diff before finishing.",
    });
  } else {
    respond({
      systemMessage: `Local-change review hook failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
