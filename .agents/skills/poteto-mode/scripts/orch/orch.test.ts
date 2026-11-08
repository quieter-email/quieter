import { afterEach, describe, expect, it } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  UserError,
  openStore,
  type Forge,
  type OpenStoreOptions,
  type Store,
} from "./store.ts";

const SCRIPT = join(import.meta.dir, "orch.ts");
const directories: string[] = [];
const handles: Store[] = [];

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "orch-test-"));
  directories.push(directory);
  return directory;
}

function useStore(
  directory: string,
  options?: OpenStoreOptions
): Store {
  const store = openStore(directory, options);
  handles.push(store);
  return store;
}

async function initializedStore(): Promise<{
  readonly directory: string;
  readonly store: Store;
}> {
  const directory = await makeDirectory();
  const store = useStore(directory);
  await store.init();
  return { directory, store };
}

function git({
  args,
  repo,
}: {
  args: readonly string[];
  repo: string;
}): string {
  const result = Bun.spawnSync(["git", "-C", repo, ...args]);
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.toString()}`
    );
  }
  return result.stdout.toString().trim();
}

async function makeGitStack(directory: string, rootBranch = "main"): Promise<{
  readonly repo: string;
  readonly mergedSha: string;
  readonly closedSha: string;
  readonly openSha: string;
  readonly draftSha: string;
}> {
  const repo = join(directory, "repo");
  await mkdir(repo);
  git({ repo, args: ["init", "--initial-branch=main"] });
  git({ repo, args: ["config", "user.name", "Orch Test"] });
  git({ repo, args: ["config", "user.email", "orch@example.com"] });
  await writeFile(join(repo, "main.txt"), "main\n");
  git({ repo, args: ["add", "."] });
  git({ repo, args: ["commit", "-m", "main"] });
  git({ repo, args: ["update-ref", "refs/remotes/origin/main", "HEAD"] });
  git({
    repo,
    args: ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
  });
  if (rootBranch !== "main") {
    git({ repo, args: ["checkout", "-b", rootBranch] });
  }

  const branches = [
    "stack/merged",
    "stack/closed",
    "stack/open",
    "stack/draft",
  ];
  for (const [index, branch] of branches.entries()) {
    git({ repo, args: ["checkout", "-b", branch] });
    await writeFile(join(repo, `stack-${index}.txt`), `${branch}\n`);
    git({ repo, args: ["add", "."] });
    git({ repo, args: ["commit", "-m", branch] });
  }
  git({ repo, args: ["checkout", "stack/open"] });

  return {
    repo,
    mergedSha: git({ repo, args: ["rev-parse", "stack/merged"] }),
    closedSha: git({ repo, args: ["rev-parse", "stack/closed"] }),
    openSha: git({ repo, args: ["rev-parse", "stack/open"] }),
    draftSha: git({ repo, args: ["rev-parse", "stack/draft"] }),
  };
}

type FixtureState = "open" | "draft" | "merged" | "closed";

interface FixturePr {
  readonly number: number;
  readonly state: FixtureState;
  readonly head: string;
  readonly base: string;
}

const FORGE_FIXTURES: Readonly<
  Record<
    Forge,
    {
      readonly fields: string;
      readonly row: (pr: FixturePr) => Record<string, unknown>;
    }
  >
> = {
  gh: {
    fields: "number,state,headRefName,baseRefName",
    row: ({ number, state, head, base }) => ({
      number,
      state: state === "draft" ? "OPEN" : state.toUpperCase(),
      headRefName: head,
      baseRefName: base,
    }),
  },
  origin: {
    fields: "number,status,headRef,baseRef",
    row: ({ number, state, head, base }) => ({
      number,
      status: state,
      headRef: head,
      baseRef: base,
    }),
  },
};

function forgeRows(
  forge: Forge,
  prs: readonly FixturePr[]
): string {
  return JSON.stringify(prs.map((pr) => FORGE_FIXTURES[forge].row(pr)));
}

async function withFakeForge<T>({
  directory,
  forge,
  operation,
  currentRows,
  rootBranch = "main",
  rows = {},
}: {
  directory: string;
  forge: Forge;
  operation: () => Promise<T>;
  currentRows?: string;
  rootBranch?: string;
  rows?: Readonly<Record<string, readonly FixturePr[]>>;
}): Promise<T> {
  const bin = join(directory, "bin");
  const outputPath = join(directory, "forge-output.txt");
  await mkdir(bin, { recursive: true });
  await writeFile(
    outputPath,
    `${
      currentRows ??
      forgeRows(forge, [
        {
          number: 11,
          state: "open",
          head: "stack/open",
          base: "stack/closed",
        },
      ])
    }\n`
  );
  const { fields } = FORGE_FIXTURES[forge];
  const list = (filter: string, branch: string): string =>
    `pr list ${filter} ${branch} --state all --json ${fields}`;
  const queries: Readonly<Record<string, readonly FixturePr[]>> = {
    "--head stack/closed": [
      { number: 13, state: "closed", head: "stack/closed", base: "stack/merged" },
    ],
    "--head stack/merged": [
      { number: 10, state: "merged", head: "stack/merged", base: rootBranch },
    ],
    [`--head ${rootBranch}`]: [],
    "--base stack/open": [
      { number: 14, state: "draft", head: "stack/draft", base: "stack/open" },
      { number: 15, state: "closed", head: "stack/abandoned", base: "stack/open" },
    ],
    "--base stack/draft": [],
    ...rows,
  };
  await writeFile(join(directory, "forge-queries.txt"), "");
  const fake = join(bin, forge);
  await writeFile(
    fake,
    `#!/usr/bin/env bash
set -euo pipefail
if [ "$(pwd -P)" != "${realpathSync(join(directory, "repo"))}" ]; then
  printf '${forge} ran outside the fixture repo: %s\\n' "$(pwd -P)" >&2
  exit 2
fi
printf '%s\\n' "$*" >> "${join(directory, "forge-queries.txt")}"
case "$*" in
  "${list("--head", "stack/open")}")
    cat "${outputPath}"
    ;;
${Object.entries(queries).map(([query, prs]) => {
  const [filter, branch] = query.split(" ");
  return `  "${list(filter!, branch!)}")
    printf '%s\\n' '${forgeRows(forge, prs)}'
    ;;`;
}).join("\n")}
  *)
    printf 'unexpected ${forge} arguments: %s\\n' "$*" >&2
    exit 2
    ;;
esac
`
  );
  await chmod(fake, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath ?? ""}`;
  try {
    return await operation();
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  }
}

function runCli(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env
): RunResult {
  const result = Bun.spawnSync([process.execPath, SCRIPT, ...args], { env });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

afterEach(async () => {
  for (const store of handles.splice(0).reverse()) {
    await store.close();
  }
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("Store", () => {

  it("escapes formula prefixes in persisted unit rows", async () => {
    const { store } = await initializedStore();
    expect(
      await store.units.add({ id: "=SUM(A1)", track: "+build" })
    ).toMatchObject({ id: "'=SUM(A1)", track: "'+build" });
  });

  it("replaces a stale lock whose holder pid is dead", async () => {
    const { directory } = await initializedStore();
    const exited = Bun.spawn(["true"]);
    await exited.exited;
    await writeFile(join(directory, ".orch.lock"), `${exited.pid}\n`);

    const stale: string[] = [];
    const recovered = useStore(directory, {
      onStaleLock: (holder) => stale.push(holder),
    });
    expect(
      await recovered.units.add({ id: "u1", track: "build" })
    ).toMatchObject({ id: "u1" });
    expect(stale).toEqual([String(exited.pid)]);
    await recovered.close();
    expect(await readdir(directory)).not.toContain(".orch.lock");
  });

  it("blocks a writer and steals the pid lock only with force", async () => {
    const { directory, store } = await initializedStore();
    await store.close();
    await writeFile(join(directory, ".orch.lock"), `${process.pid}\n`);

    const blocked = useStore(directory);
    await expect(
      blocked.units.add({ id: "u1", track: "build" })
    ).rejects.toThrow(`store lock held by pid ${process.pid}`);

    const stolen: string[] = [];
    const forced = useStore(directory, {
      force: true,
      onLockStolen: (holder) => stolen.push(holder),
    });
    expect(
      await forced.units.add({ id: "u1", track: "build" })
    ).toMatchObject({ id: "u1" });
    expect(stolen).toEqual([String(process.pid)]);
    await forced.close();
    expect(await readdir(directory)).not.toContain(".orch.lock");
  });

  for (const forge of ["gh", "origin"] as const) {
    it(`resolves the ordered frontier from the ${forge} base chain and validates an optional pin`, async () => {
      const { directory, store } = await initializedStore();
      const stack = await makeGitStack(directory);
      const forgeParams = forge === "gh" ? {} : { forge };

      await withFakeForge({
        directory,
        forge,
        operation: async () => {
          expect(
            await store.frontier.set({ repo: stack.repo, ...forgeParams })
          ).toEqual({
            generation: 1,
            prs: [
              {
                pr: 10,
                branches: "stack/merged",
                sha: stack.mergedSha,
                state: "MERGED",
              },
              {
                pr: 13,
                branches: "stack/closed",
                sha: stack.closedSha,
                state: "CLOSED",
              },
              {
                pr: 11,
                branches: "stack/open",
                sha: stack.openSha,
                state: "OPEN",
              },
              {
                pr: 14,
                branches: "stack/draft",
                sha: stack.draftSha,
                state: "OPEN",
              },
            ],
            lowestUnmerged: 11,
          });
          expect(
            (
              await store.frontier.set({
                repo: stack.repo,
                ...forgeParams,
                prs: [10, 13, 11, 14],
              })
            ).generation
          ).toBe(2);
          expect((await store.frontier.show()).generation).toBe(2);
          await expect(
            store.frontier.set({
              repo: stack.repo,
              ...forgeParams,
              prs: [10, 11, 12],
            })
          ).rejects.toThrow(
            "frontier pin mismatch: missing from resolved chain: 12; extra in resolved chain: 13,14"
          );
          await expect(
            store.frontier.set({
              repo: stack.repo,
              ...forgeParams,
              prs: [13, 10, 11, 14],
            })
          ).rejects.toThrow(
            "frontier pin mismatch: order differs: expected 13,10,11,14; resolved 10,13,11,14"
          );
          await expect(
            store.frontier.set({
              repo: stack.repo,
              ...forgeParams,
              prs: [10, 10],
            })
          ).rejects.toThrow("--prs must not contain duplicates");
        },
      });
    });

    it(`resolves a replacement ${forge} PR alongside closed branch history`, async () => {
      for (const historicalState of ["closed", "merged"] as const) {
        const { directory, store } = await initializedStore();
        const stack = await makeGitStack(directory);
        await withFakeForge({
          directory, forge,
          currentRows: forgeRows(forge, [
            { number: 9, state: historicalState, head: "stack/open", base: "main" },
            { number: 11, state: "open", head: "stack/open", base: "stack/closed" },
          ]),
          operation: async () => {
            const frontier = await store.frontier.set({ repo: stack.repo, forge });
            expect(frontier.prs.map((row) => row.pr)).toEqual([10, 13, 11, 14]);
            expect(frontier.lowestUnmerged).toBe(11);
          },
        });
      }
    });

    it(`still rejects multiple active ${forge} PRs on one branch`, async () => {
      const { directory, store } = await initializedStore();
      const stack = await makeGitStack(directory);
      await withFakeForge({
        directory, forge,
        currentRows: forgeRows(forge, [
          { number: 11, state: "open", head: "stack/open", base: "stack/closed" },
          { number: 12, state: "open", head: "stack/open", base: "main" },
        ]),
        operation: async () => {
          await expect(store.frontier.set({ repo: stack.repo, forge })).rejects.toThrow("multiple pull requests");
        },
      });
    });

    it(`rejects unparseable ${forge} output loudly`, async () => {
      const { directory, store } = await initializedStore();
      const stack = await makeGitStack(directory);

      await withFakeForge({
        directory,
        forge,
        currentRows: "this line is not forge output",
        operation: async () => {
          await expect(
            store.frontier.set({ repo: stack.repo, forge })
          ).rejects.toThrow(
            `${forge} pr list --head stack/open output is not valid JSON`
          );
        },
      });
    });
  }

  it("rejects malformed TSV, verdict, frontier, and inbox data", async () => {
    const { directory, store } = await initializedStore();

    await writeFile(join(directory, "units.tsv"), "wrong\n");
    await expect(store.units.list()).rejects.toThrow(
      "units.tsv has an invalid header"
    );
    await writeFile(
      join(directory, "units.tsv"),
      "id\ttrack\tstate\tbranch\tpr\tsha\tbrief\nshort\trow\n"
    );
    await expect(store.units.list()).rejects.toThrow(
      "units.tsv has a malformed row"
    );

    await writeFile(
      join(directory, "ledger.tsv"),
      "pr\tsha\tverdict\tevidence\tverifier\tts\n1\tsha\tinvalid\treport\tme\tnow\n"
    );
    await expect(store.ledger.summary()).rejects.toThrow(
      "ledger.tsv has invalid verdict invalid"
    );

    await writeFile(join(directory, "frontier.json"), '{"generation":"1"}\n');
    await expect(store.frontier.show()).rejects.toThrow(
      "frontier.json has an invalid shape"
    );

    await writeFile(join(directory, "inbox", "bad.tsv"), "too\tshort\n");
    await expect(store.inbox.peek()).rejects.toThrow(
      "inbox pointer bad.tsv is malformed"
    );
  });

});

describe("orch CLI", () => {
  it("rejects invalid and nonexistent explicit bases without changing the frontier or querying the forge", async () => {
    const directory = await makeDirectory();
    const stack = await makeGitStack(directory, "integration/release");
    expect(runCli(["--store", directory, "init"]).code).toBe(0);
    await withFakeForge({
      directory,
      forge: "gh",
      rootBranch: "integration/release",
      operation: async () => {
        const args = [
          "--store", directory, "--json", "frontier", "set", "--repo", stack.repo,
        ];
        expect(runCli([...args, "--base", "integration/release"]).code).toBe(0);
        const cliFrontier = JSON.parse(runCli([
          "--store", directory, "--json", "frontier", "show",
        ]).stdout);
        const cliBefore = await readFile(join(directory, "frontier.json"), "utf8");
        const cliQueries = await readFile(join(directory, "forge-queries.txt"), "utf8");
        const invalidBases = [
          "", "--help", "-main", "HEAD", "HEAD~1", "main^0", "main..stack/open",
          "@", "@{-1}", " integration/release ", "\tintegration/release\n",
          stack.openSha, "refs/heads/main", "bad..branch", "integration/missing",
        ];
        for (const base of invalidBases) {
          const result = runCli([...args, `--base=${base}`]);
          expect(result.code).toBe(1);
          expect(result.stderr).toMatch(
            /invalid base branch:|git check-ref-format --branch [\s\S]* failed:|base branch [\s\S]* does not exist locally or on origin/
          );
          expect(result.stderr).not.toContain("store lock held");
          expect(result.stderr).not.toContain("unknown option");
          expect(await readFile(join(directory, "frontier.json"), "utf8")).toBe(cliBefore);
          expect(await readFile(join(directory, "forge-queries.txt"), "utf8")).toBe(cliQueries);
        }
        const store = useStore(directory);
        expect(await store.frontier.set({
          repo: stack.repo,
          baseBranch: "integration/release",
        })).toEqual({ ...cliFrontier, generation: 2 });
        const before = await readFile(join(directory, "frontier.json"), "utf8");
        const queries = await readFile(join(directory, "forge-queries.txt"), "utf8");
        for (const base of invalidBases) {
          await expect(store.frontier.set({
            repo: stack.repo,
            baseBranch: base,
          })).rejects.toBeInstanceOf(UserError);
          expect(await readFile(join(directory, "frontier.json"), "utf8")).toBe(before);
          expect(await readFile(join(directory, "forge-queries.txt"), "utf8")).toBe(queries);
        }
      },
    });
  });

  const invalidFrontierScenarios: readonly {
    name: string;
    pin?: string;
    rows: Readonly<Record<string, readonly FixturePr[]>>;
    error: string;
  }[] = [
    {
      name: "pin mismatch",
      pin: "13,10,11,14",
      rows: {},
      error: "frontier pin mismatch",
    },
    {
      name: "upward cycle",
      rows: {
        "--head stack/merged": [
          { number: 10, state: "merged", head: "stack/merged", base: "stack/open" },
        ],
      },
      error: "pull request base chain loops",
    },
    {
      name: "downward cycle",
      rows: {
        "--base stack/draft": [
          { number: 11, state: "open", head: "stack/open", base: "stack/draft" },
        ],
      },
      error: "pull request base chain loops",
    },
    {
      name: "nonlinear open children",
      rows: {
        "--base stack/open": [
          { number: 14, state: "draft", head: "stack/draft", base: "stack/open" },
          { number: 16, state: "open", head: "stack/other", base: "stack/open" },
        ],
      },
      error: "stack is not linear",
    },
  ];
  for (const scenario of invalidFrontierScenarios) {
    it(`preserves the CLI frontier on an explicit-base ${scenario.name}`, async () => {
      const directory = await makeDirectory();
      const stack = await makeGitStack(directory, "integration/release");
      expect(runCli(["--store", directory, "init"]).code).toBe(0);
      const args = [
        "--store", directory, "--json", "frontier", "set",
        "--repo", stack.repo, "--base", "integration/release",
      ];
      await withFakeForge({
        directory,
        forge: "gh",
        rootBranch: "integration/release",
        operation: async () => {
          expect(runCli(args).code).toBe(0);
        },
      });
      const before = await readFile(join(directory, "frontier.json"), "utf8");
      await withFakeForge({
        directory,
        forge: "gh",
        rootBranch: "integration/release",
        rows: scenario.rows,
        operation: async () => {
          const result = runCli([
            ...args, ...(scenario.pin ? ["--prs", scenario.pin] : []),
          ]);
          expect(result.code).toBe(1);
          expect(result.stderr).toContain(scenario.error);
          expect(await readFile(join(directory, "frontier.json"), "utf8")).toBe(before);
        },
      });
    });
  }

});
