import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vite-plus/test";
import { parseDocument } from "yaml";
import { z } from "zod";

const workflow = z
  .object({
    jobs: z.object({
      recover: z.object({
        environment: z.string(),
        if: z.string(),
        steps: z.array(
          z.object({
            name: z.string().optional(),
            run: z.string().optional(),
            uses: z.string().optional(),
          })
        ),
      }),
    }),
  })
  .parse(
    parseDocument(
      await readFile(
        new URL("../.github/workflows/ai-credit-recovery.yml", import.meta.url),
        "utf8"
      )
    ).toJSON()
  );
const guard = workflow.jobs.recover.steps.find(
  (step) => step.name === "Require trusted deployed main revision"
);
const guardScript = z.string().parse(guard?.run);

describe("protected AI credit recovery execution", () => {
  test("requires the protected environment and rejects branch execution before credentials", () => {
    expect(workflow.jobs.recover.environment).toBe("production");
    expect(workflow.jobs.recover.if).toContain(
      "github.ref == 'refs/heads/main'"
    );
    const guardIndex = workflow.jobs.recover.steps.indexOf(guard ?? {});
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(guardIndex).toBeLessThan(
      workflow.jobs.recover.steps.findIndex(
        (step) =>
          step.uses?.startsWith("aws-actions/configure-aws-credentials") ===
          true
      )
    );
  });

  test.each([
    ["refs/heads/main", "trusted", "trusted success", "admin", "admin", true],
    [
      "refs/heads/feature",
      "trusted",
      "trusted success",
      "admin",
      "admin",
      false,
    ],
    ["refs/heads/main", "new-main", "trusted success", "admin", "admin", false],
    ["refs/heads/main", "trusted", "older success", "admin", "admin", false],
    ["refs/heads/main", "trusted", "trusted failure", "admin", "admin", false],
    ["refs/heads/main", "trusted", "trusted success", "write", "write", false],
    [
      "refs/heads/main",
      "trusted",
      "trusted success",
      "maintain",
      "maintain",
      false,
    ],
    ["refs/heads/main", "trusted", "trusted success", "admin", "write", false],
  ])(
    "checks deployed main using real shell guards for %s %s %s",
    (ref, main, deployment, permission, triggeringPermission, allowed) => {
      const result = spawnSync(
        "bash",
        [
          "-euo",
          "pipefail",
          "-c",
          `gh() { case "$2" in */collaborators/synthetic-rerunner/permission) echo "$FIXTURE_TRIGGERING_PERMISSION";; */collaborators/*/permission) echo "$FIXTURE_PERMISSION";; */git/ref/heads/main) echo "$FIXTURE_MAIN";; *) echo "$FIXTURE_DEPLOYMENT";; esac; }\n${guardScript}`,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            FIXTURE_DEPLOYMENT: deployment,
            FIXTURE_MAIN: main,
            FIXTURE_PERMISSION: permission,
            FIXTURE_TRIGGERING_PERMISSION: triggeringPermission,
            GITHUB_ACTOR: "synthetic-admin",
            GITHUB_REF: ref,
            GITHUB_REPOSITORY: "synthetic/repo",
            GITHUB_SHA: "trusted",
            GITHUB_TRIGGERING_ACTOR: "synthetic-rerunner",
          },
        }
      );
      expect(result.status === 0).toBe(allowed);
    }
  );

  test("CLI refuses unapproved execution without printing its request", () => {
    const marker = "private-request-marker";
    const result = spawnSync(
      process.execPath,
      ["scripts/ai-credit-recovery.ts", marker, "--invalid"],
      { encoding: "utf8" }
    );
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).not.toContain(marker);
  });
});
