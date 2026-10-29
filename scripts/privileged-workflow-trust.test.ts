import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, test, vi } from "vite-plus/test";
import { isSeq, parseDocument } from "yaml";

const sdk = parseDocument(
  readFileSync(
    new URL("../.github/workflows/sdk-publish.yml", import.meta.url),
    "utf8"
  )
);
const backfill = parseDocument(
  readFileSync(
    new URL(
      "../.github/workflows/managed-mail-r2-backfill.yml",
      import.meta.url
    ),
    "utf8"
  )
);

describe("privileged workflow trust", () => {
  test.each([
    ["workflow_dispatch", "refs/heads/main", true, true],
    ["workflow_dispatch", "refs/heads/feature", false, false],
    ["workflow_dispatch", "refs/tags/main", false, false],
    ["workflow_dispatch", "refs/tags/sdk-v1.0.0", false, false],
    ["release", "refs/tags/sdk-v1.0.0", false, false],
    ["workflow_run", "refs/heads/main", false, true],
    ["workflow_run", "refs/heads/feature", false, false],
    ["release", "refs/tags/v1.0.0", false, false],
    ["push", "refs/heads/main", false, false],
  ])("authorizes event %s at %s", (eventName, ref, allowBackfill, allowSdk) => {
    for (const [document, job, expected] of [
      [backfill, "backfill", allowBackfill],
      [sdk, "authorize", allowSdk],
    ] as const) {
      const condition: unknown = document.getIn(["jobs", job, "if"]);
      if (typeof condition !== "string") {
        throw new TypeError("Missing source authorization condition.");
      }
      expect(
        runInNewContext(condition, {
          github: { event_name: eventName, ref },
          startsWith: (value: string, prefix: string) =>
            value.startsWith(prefix),
        })
      ).toBe(expected);
    }
  });

  test.each(["ahead", "identical", "behind", "diverged", "unknown"])(
    "checks immutable revision ancestry: %s",
    async (status) => {
      const script: unknown = sdk.getIn([
        "jobs",
        "authorize",
        "steps",
        0,
        "with",
        "script",
      ]);
      if (typeof script !== "string") {
        throw new TypeError("Missing ancestry verification.");
      }
      const compareCommits = vi
        .fn<() => Promise<{ data: { status: string } }>>()
        .mockResolvedValue({ data: { status } });
      const setOutput = vi.fn<(key: string, value: string) => void>();
      const execution: unknown = runInNewContext(
        `(async () => { ${script} })()`,
        {
          context: {
            repo: { owner: "owner", repo: "repo" },
            sha: "immutable-event-sha",
          },
          core: { info: vi.fn<(message: string) => void>(), setOutput },
          github: { rest: { repos: { compareCommits } } },
        }
      );
      const allowed = status === "ahead" || status === "identical";
      const result = await Promise.resolve(execution).then(
        () => "authorized",
        () => "rejected"
      );
      expect(result).toBe(allowed ? "authorized" : "rejected");
      expect(setOutput.mock.calls).toStrictEqual(
        allowed
          ? [
              ["sha", "immutable-event-sha"],
              ["tag", ""],
            ]
          : []
      );
      expect(compareCommits).toHaveBeenCalledWith(
        expect.objectContaining({
          base: "immutable-event-sha",
          head: "main",
        })
      );
    }
  );

  test.each([
    [
      "release",
      "success",
      ".github/workflows/sdk-release-request.yml",
      "owner/repo",
      "sdk-v1.0.0",
      true,
    ],
    [
      "workflow_dispatch",
      "success",
      ".github/workflows/sdk-release-request.yml",
      "owner/repo",
      "sdk-v1.0.0",
      false,
    ],
    [
      "release",
      "failure",
      ".github/workflows/sdk-release-request.yml",
      "owner/repo",
      "sdk-v1.0.0",
      false,
    ],
    [
      "release",
      "success",
      ".github/workflows/other.yml",
      "owner/repo",
      "sdk-v1.0.0",
      false,
    ],
    [
      "release",
      "success",
      ".github/workflows/sdk-release-request.yml",
      "attacker/repo",
      "sdk-v1.0.0",
      false,
    ],
    [
      "release",
      "success",
      ".github/workflows/sdk-release-request.yml",
      "owner/repo",
      "main",
      false,
    ],
  ])(
    "verifies release request %s %s %s %s %s",
    async (event, conclusion, path, repository, branch, allowed) => {
      const script: unknown = sdk.getIn([
        "jobs",
        "authorize",
        "steps",
        0,
        "with",
        "script",
      ]);
      if (typeof script !== "string") {
        throw new TypeError("Missing release authorization.");
      }
      const compareCommits = vi
        .fn<() => Promise<{ data: { status: string } }>>()
        .mockResolvedValue({ data: { status: "ahead" } });
      const getWorkflowRun = vi.fn<() => Promise<unknown>>().mockResolvedValue({
        data: {
          conclusion,
          event,
          head_branch: branch,
          head_repository: { full_name: repository },
          head_sha: "release-sha",
          path,
        },
      });
      const setOutput = vi.fn<(key: string, value: string) => void>();
      const execution: unknown = runInNewContext(
        `(async () => { ${script} })()`,
        {
          context: {
            eventName: "workflow_run",
            payload: { workflow_run: { id: 42 } },
            repo: { owner: "owner", repo: "repo" },
            sha: "default-main-sha",
          },
          core: { info: vi.fn<(message: string) => void>(), setOutput },
          github: {
            rest: { actions: { getWorkflowRun }, repos: { compareCommits } },
          },
        }
      );
      const result = await Promise.resolve(execution).then(
        () => "authorized",
        () => "rejected"
      );
      expect(result).toBe(allowed ? "authorized" : "rejected");
      expect(setOutput.mock.calls).toStrictEqual(
        allowed
          ? [
              ["sha", "release-sha"],
              ["tag", branch],
            ]
          : []
      );
      expect(compareCommits).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(getWorkflowRun).toHaveBeenCalledWith(
        expect.objectContaining({ run_id: 42 })
      );
    }
  );

  test("keeps repository code behind authorization and pins privileged checkout", () => {
    expect(sdk.getIn(["permissions", "id-token"])).toBeUndefined();
    expect(sdk.getIn(["jobs", "authorize", "environment"])).toBeUndefined();
    const steps = sdk.getIn(["jobs", "authorize", "steps"]);
    expect(isSeq(steps) && steps.items.length === 1).toBeTruthy();
    expect(sdk.getIn(["jobs", "publish", "needs"])).toBe("authorize");
    expect(sdk.getIn(["jobs", "publish", "steps", 0, "with", "ref"])).toBe(
      `\${{ needs.authorize.outputs.sha }}`
    );
    expect(
      backfill.getIn(["jobs", "backfill", "steps", 0, "with", "ref"])
    ).toBe(`\${{ github.sha }}`);
    for (const [document, job] of [
      [sdk, "publish"],
      [backfill, "backfill"],
    ] as const) {
      expect(
        document.getIn(["jobs", job, "steps", 0, "with", "persist-credentials"])
      ).toBeFalsy();
    }
  });
});
