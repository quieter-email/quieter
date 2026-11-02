import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, test, vi } from "vite-plus/test";
import { parseDocument } from "yaml";

const script: unknown = parseDocument(
  readFileSync(
    new URL("../.github/workflows/sst-deploy.yml", import.meta.url),
    "utf8"
  )
).getIn(["jobs", "prior-checks", "steps", 0, "with", "script"]);

if (typeof script !== "string") {
  throw new TypeError("The release verification script is missing.");
}

const createEvidence = () => {
  const context = {
    eventName: "push",
    ref: "refs/heads/main",
    repo: { owner: "quieter-email", repo: "quieter" },
    sha: "verified-commit",
  };
  const run = {
    conclusion: "success",
    event: "merge_group",
    head_branch: "gh-readonly-queue/main/pr-123-base",
    head_repository: { full_name: "quieter-email/quieter" },
    head_sha: context.sha,
    id: 42,
    path: ".github/workflows/ci-main.yml",
    run_attempt: 1,
    status: "completed",
    updated_at: "2026-10-23T00:00:00Z",
  };
  const job = {
    conclusion: "success",
    run_attempt: run.run_attempt,
    run_id: run.id,
    status: "completed",
  };
  const runs = { data: { total_count: 1, workflow_runs: [run] } };
  const jobs = { data: { jobs: [job], total_count: 1 } };
  const github = {
    rest: {
      actions: {
        getWorkflowRun: vi
          .fn<() => Promise<{ data: typeof run }>>()
          .mockResolvedValue({ data: run }),
        listJobsForWorkflowRun: vi
          .fn<() => Promise<typeof jobs>>()
          .mockResolvedValue(jobs),
        listWorkflowRuns: vi
          .fn<() => Promise<typeof runs>>()
          .mockResolvedValue(runs),
      },
    },
  };
  const outputs = new Map<string, string>();
  const core = {
    info: vi.fn<(message: string) => void>(),
    setOutput: (key: string, value: string) => {
      outputs.set(key, value);
    },
    summary: {
      addHeading: vi.fn<() => unknown>().mockReturnThis(),
      addLink: vi.fn<() => unknown>().mockReturnThis(),
      write: vi.fn<() => Promise<null>>().mockResolvedValue(null),
    },
    warning: vi.fn<(message: string) => void>(),
  };

  return { context, core, github, job, outputs, run };
};

const execute = async (evidence: ReturnType<typeof createEvidence>) => {
  await runInNewContext(`(async () => {\n${script}\n})()`, evidence);
  return evidence.outputs.get("reuse");
};

describe("release verification reuse", () => {
  test("reuses successful exact-commit merge queue checks", async () => {
    await expect(execute(createEvidence())).resolves.toBe("true");
  });

  test.each([
    { eventName: "workflow_dispatch" },
    { ref: "refs/heads/feature" },
  ])("requires fresh checks outside a main push", async (change) => {
    const evidence = createEvidence();
    Object.assign(evidence.context, change);
    await expect(execute(evidence)).resolves.toBe("false");
  });

  test.each([
    { head_sha: "other-commit" },
    { event: "pull_request" },
    { path: ".github/workflows/other.yml" },
    { head_repository: { full_name: "someone/else" } },
    { head_branch: "gh-readonly-queue/other/pr-123-base" },
    { status: "in_progress" },
    { conclusion: "failure" },
    { run_attempt: 0 },
  ])(
    "rejects evidence with different provenance or unsuccessful state",
    async (change) => {
      const evidence = createEvidence();
      Object.assign(evidence.run, change);
      await expect(execute(evidence)).resolves.toBe("false");
    }
  );

  test("does not select an older success over a newer failed attempt", async () => {
    const evidence = createEvidence();
    evidence.github.rest.actions.listWorkflowRuns.mockResolvedValue({
      data: {
        total_count: 2,
        workflow_runs: [
          evidence.run,
          {
            ...evidence.run,
            conclusion: "failure",
            id: 41,
            updated_at: "2026-10-23T00:01:00Z",
          },
        ],
      },
    });
    evidence.github.rest.actions.getWorkflowRun.mockResolvedValue({
      data: { ...evidence.run, conclusion: "failure", id: 41 },
    });
    await expect(execute(evidence)).resolves.toBe("false");
  });

  test.each(["skipped", "neutral", "failure", "cancelled"])(
    "rejects a %s verification job",
    async (conclusion) => {
      const evidence = createEvidence();
      evidence.job.conclusion = conclusion;
      await expect(execute(evidence)).resolves.toBe("false");
    }
  );

  test("rejects jobs retained from an earlier attempt", async () => {
    const evidence = createEvidence();
    evidence.job.run_attempt = 2;
    await expect(execute(evidence)).resolves.toBe("false");
  });

  test.each(["runs", "jobs"])(
    "rejects incomplete %s evidence",
    async (source) => {
      const evidence = createEvidence();
      if (source === "runs") {
        evidence.github.rest.actions.listWorkflowRuns.mockResolvedValue({
          data: { total_count: 2, workflow_runs: [evidence.run] },
        });
      } else {
        evidence.github.rest.actions.listJobsForWorkflowRun.mockResolvedValue({
          data: { jobs: [evidence.job], total_count: 2 },
        });
      }
      await expect(execute(evidence)).resolves.toBe("false");
    }
  );

  test("falls back when no previous verification exists", async () => {
    const evidence = createEvidence();
    evidence.github.rest.actions.listWorkflowRuns.mockResolvedValue({
      data: { total_count: 0, workflow_runs: [] },
    });
    await expect(execute(evidence)).resolves.toBe("false");
  });

  test("falls back on an unreadable API response", async () => {
    const evidence = createEvidence();
    evidence.github.rest.actions.listJobsForWorkflowRun.mockRejectedValue(
      new Error("Unavailable")
    );
    await expect(execute(evidence)).resolves.toBe("false");
  });

  test("rejects a verification rerun started during lookup", async () => {
    const evidence = createEvidence();
    evidence.github.rest.actions.getWorkflowRun
      .mockResolvedValueOnce({ data: evidence.run })
      .mockResolvedValueOnce({
        data: {
          ...evidence.run,
          conclusion: "cancelled",
          run_attempt: 2,
          status: "in_progress",
        },
      });
    await expect(execute(evidence)).resolves.toBe("false");
  });
});
