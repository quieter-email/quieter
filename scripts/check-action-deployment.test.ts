/* oxlint-disable promise/prefer-await-to-callbacks -- The fixture implements Node execFile callbacks. */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PERSONAL_ACTION_PROTOCOL } from "@quieter/env/deployment";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  checkActionDeployment,
  securePrivateReleaseWorkers,
} from "./check-action-deployment.ts";

const lambda = vi.hoisted(() => ({ buildId: "new-build" }));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The fixture replaces an overloaded Node API with its callback contract.
vi.mock("node:child_process", () => ({
  execFile: (
    _command: string,
    _args: string[],
    _options: unknown,
    callback: (error: Error | null, stdout: string) => void
  ) => {
    callback(
      null,
      JSON.stringify({
        buildId: lambda.buildId,
        code: "hash",
        protocol: "personal-actions-v1",
        revision: "revision",
        state: "Active",
        update: "Successful",
      })
    );
  },
}));

const version = "11111111-1111-4111-8111-111111111111";
let directory = "";
let staleWorker = "";
let publicSlot = false;
let incompatible = false;
let processorBinding = "gmail-processing";
let processorRegion = "aws:eu-central-1";
let processorScript = "gmail-processing";
let extraPlacementTarget = false;
let publicProcessor = false;
let placementMissing = false;
let placementWriteFails = false;

const verify = async () => {
  await checkActionDeployment({
    account: "a".repeat(32),
    buildId: "new-build",
    evidenceFile: path.join(directory, "evidence.json"),
    outputsFile: path.join(directory, "outputs.json"),
    sourceCommit: "a".repeat(40),
    token: "test",
  });
};

describe("deployed Action consumer verification", () => {
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "quieter-consumers-"));
    staleWorker = "";
    publicSlot = false;
    incompatible = false;
    processorBinding = "gmail-processing";
    processorRegion = "aws:eu-central-1";
    processorScript = "gmail-processing";
    extraPlacementTarget = false;
    publicProcessor = false;
    placementMissing = false;
    placementWriteFails = false;
    lambda.buildId = "new-build";
    await writeFile(
      path.join(directory, "outputs.json"),
      JSON.stringify({
        actionDeploymentTargets: {
          lambdas: { mailInbound: "arn:inbound", mailReceipt: "arn:receipt" },
          workers: {
            gmailMaintenance: "gmail-maintenance",
            gmailProcessing: "gmail-processing",
            gmailRealtime: "gmail-realtime",
            mailMaintenance: "mail-maintenance",
          },
        },
        stage: "production",
      })
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        let result: unknown;
        if (url.endsWith("/settings") && init?.method === "PATCH") {
          if (placementWriteFails) {
            return Response.json({ success: false }, { status: 500 });
          }
          placementMissing = false;
          return Response.json({ success: true });
        }
        if (url.endsWith("deployment.json")) {
          return Response.json({
            current: {
              buildId: "new-build",
              protocol: incompatible ? undefined : PERSONAL_ACTION_PROTOCOL,
              slot: "a",
            },
            previous: null,
            serverTime: Date.now(),
          });
        }
        if (url.endsWith("/deployments")) {
          result = {
            deployments: [
              {
                created_on: "2026-11-04T00:00:00Z",
                versions: [{ percentage: 100, version_id: version }],
              },
            ],
          };
        } else if (url.endsWith("/subdomain")) {
          const exposed = url.includes("/gmail-processing/")
            ? publicProcessor
            : publicSlot;
          result = {
            enabled: url.includes("/gmail-processing/") ? false : publicSlot,
            previews_enabled: exposed,
          };
        } else if (url.endsWith("/scripts")) {
          result = [
            { id: "unrelated-worker" },
            {
              id: processorScript,
              placement: placementMissing
                ? undefined
                : {
                    mode: "targeted",
                    target: [
                      { id: 39, region: processorRegion, type: "region" },
                      ...(extraPlacementTarget
                        ? [{ region: "aws:us-east-1", type: "region" }]
                        : []),
                    ],
                  },
            },
          ];
        } else if (url.endsWith("/settings")) {
          result = { placement: { mode: "targeted", target: [39] } };
        } else {
          result = {
            id: version,
            resources: {
              bindings: [
                {
                  name: "GmailProcessingWorker",
                  service: processorBinding,
                  type: "service",
                },
                {
                  name: "QUIETER_ACTION_PROTOCOL",
                  text: PERSONAL_ACTION_PROTOCOL,
                  type: "plain_text",
                },
                {
                  name: "QUIETER_BUILD_ID",
                  text:
                    staleWorker !== "" && url.includes(staleWorker)
                      ? "old-build"
                      : "new-build",
                  type: "plain_text",
                },
              ],
            },
          };
        }
        return Response.json({ result, success: true });
      })
    );
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(directory, { force: true, recursive: true });
  });

  test("records evidence only after all producers, executor, and private slots match", async () => {
    await verify();
    const evidence: unknown = JSON.parse(
      await readFile(path.join(directory, "evidence.json"), "utf-8")
    );
    expect(evidence).toMatchObject({ buildId: "new-build" });
  });

  test.each([
    "gmail-maintenance",
    "gmail-processing",
    "gmail-realtime",
    "mail-maintenance",
    "web-release-a",
    "web-release-b",
  ])("rejects a stale %s and leaves no release evidence", async (script) => {
    staleWorker = script;
    await expect(verify()).rejects.toThrow("expected build");
    await expect(
      readFile(path.join(directory, "evidence.json"))
    ).rejects.toThrow(/./u);
  });

  test("rejects a stale AWS producer", async () => {
    lambda.buildId = "old-build";
    await expect(verify()).rejects.toThrow(/./u);
    await expect(
      readFile(path.join(directory, "evidence.json"))
    ).rejects.toThrow(/./u);
  });

  test("rejects public direct access to private release slots", async () => {
    publicSlot = true;
    await expect(verify()).rejects.toThrow("workers.dev");
  });

  test("rejects a processor preview URL", async () => {
    publicProcessor = true;
    await expect(verify()).rejects.toThrow("workers.dev");
  });

  test("disables direct and preview access to the deployed processor", async () => {
    await securePrivateReleaseWorkers({
      account: "a".repeat(32),
      outputsFile: path.join(directory, "outputs.json"),
      token: "test",
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/scripts/gmail-processing/subdomain"),
      expect.objectContaining({
        body: JSON.stringify({ enabled: false, previews_enabled: false }),
        method: "POST",
      })
    );
  });

  test("restores upload-cleared placement before release verification", async () => {
    placementMissing = true;
    await expect(verify()).rejects.toThrow(/./u);
    await securePrivateReleaseWorkers({
      account: "a".repeat(32),
      outputsFile: path.join(directory, "outputs.json"),
      token: "test",
    });
    const settingsCall = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, init]) =>
          typeof url === "string" &&
          url.endsWith("/scripts/gmail-processing/settings") &&
          init?.method === "PATCH"
      );
    expect(settingsCall?.[1]?.body).toBeInstanceOf(FormData);
    await verify();
  });

  test("fails the release when placement cannot be restored", async () => {
    placementMissing = true;
    placementWriteFails = true;
    await expect(
      securePrivateReleaseWorkers({
        account: "a".repeat(32),
        outputsFile: path.join(directory, "outputs.json"),
        token: "test",
      })
    ).rejects.toThrow("placement");
    await expect(
      readFile(path.join(directory, "evidence.json"))
    ).rejects.toThrow(/./u);
  });

  test("rejects a queue consumer bound to another processor", async () => {
    processorBinding = "unexpected-worker";
    await expect(verify()).rejects.toThrow("processor binding");
  });

  test("rejects missing regional processor placement", async () => {
    processorRegion = "aws:us-east-1";
    await expect(verify()).rejects.toThrow(/./u);
  });

  test("rejects placement metadata for a different script", async () => {
    processorScript = "another-processor";
    await expect(verify()).rejects.toThrow(/./u);
  });

  test("rejects additional placement targets", async () => {
    extraPlacementTarget = true;
    await expect(verify()).rejects.toThrow(/./u);
  });

  test("rejects a router with no compatible Action protocol", async () => {
    incompatible = true;
    await expect(verify()).rejects.toThrow("incompatible Action release");
  });
});
