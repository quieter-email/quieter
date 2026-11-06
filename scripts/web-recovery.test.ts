/* oxlint-disable vitest/no-conditional-expect, eslint/require-await -- Table-driven transport fixtures cover success and rejection paths. */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { recoverWeb } from "./web-recovery.ts";

vi.mock(import("./check-deployment.ts"), () => ({
  checkDeployment: vi.fn<(origin: string, buildId: string) => Promise<void>>(),
}));
const { checkDeployment } = await import("./check-deployment.ts");
const account = "a".repeat(32);
const version = "11111111-1111-4111-8111-111111111111";
const previous = "22222222-2222-4222-8222-222222222222";
const release = `${"a".repeat(40)}-123`;
let directory = "";
let recordFile = "";
let mutations: unknown[] = [];

describe("web recovery", () => {
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "quieter-recovery-"));
    recordFile = path.join(directory, "previous.json");
    mutations = [];
    vi.mocked(checkDeployment).mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, options?: RequestInit) => {
        if (input.endsWith("/assets/deployment.json")) {
          return new Response(null, { status: 404 });
        }
        if (input.endsWith("/assets/build-id.txt")) {
          return new Response("healthy-build", {
            headers: { "content-type": "text/plain" },
          });
        }
        if (options?.method === "POST") {
          mutations.push(
            JSON.parse(typeof options.body === "string" ? options.body : "null")
          );
          return Response.json({ result: {}, success: true });
        }
        return Response.json({
          result: input.endsWith("/domains")
            ? [{ hostname: "quieter.email", service: "web" }]
            : {
                deployments: [
                  {
                    created_on: "2026-09-06",
                    versions: [{ percentage: 100, version_id: version }],
                  },
                ],
              },
          success: true,
        });
      })
    );
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(directory, { force: true, recursive: true });
  });

  test("records only a healthy previous version", async () => {
    await recoverWeb({
      account,
      mode: "record",
      recordFile,
      release,
      token: "test",
    });
    const record: unknown = JSON.parse(await readFile(recordFile, "utf-8"));
    expect(record).toStrictEqual({
      account,
      buildId: "healthy-build",
      release,
      script: "web",
      version,
    });
    expect(mutations).toHaveLength(0);
    expect(checkDeployment).toHaveBeenCalledWith(
      "https://quieter.email",
      "healthy-build"
    );
  });

  test("refuses to record an unhealthy release", async () => {
    vi.mocked(checkDeployment).mockRejectedValue(new Error("unhealthy"));
    await expect(
      recoverWeb({
        account,
        mode: "record",
        recordFile,
        release,
        token: "test",
      })
    ).rejects.toThrow("unhealthy");
    await expect(readFile(recordFile)).rejects.toThrow(/./u);
    expect(mutations).toHaveLength(0);
  });

  test.each([true, false])(
    "restores only compatible retained router manifests %s",
    async (compatible) => {
      const target = {
        buildId: "healthy-build",
        protocol: "personal-actions-v1",
        slot: "a",
      };
      await writeFile(
        recordFile,
        JSON.stringify({
          account,
          buildId: "healthy-build",
          deployment: {
            current: target,
            previous: compatible
              ? null
              : {
                  buildId: "legacy",
                  expiresAt: Date.now() + 60_000,
                  slot: "b",
                },
          },
          release,
          script: "web",
          version: previous,
        })
      );
      const original = fetch;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, options?: RequestInit) => {
          if (url.endsWith("deployment.json")) {
            return Response.json({
              current: target,
              previous: null,
              serverTime: Date.now(),
            });
          }
          if (url.endsWith("/api/health")) {
            return Response.json({ buildId: "healthy-build", healthy: true });
          }
          return await original(url, options);
        })
      );
      const restoration = recoverWeb({
        account,
        expectedVersion: version,
        mode: "restore",
        recordFile,
        token: "test",
      });
      if (compatible) {
        await restoration;
      } else {
        await expect(restoration).rejects.toThrow("recovery release expired");
      }
      expect(mutations).toHaveLength(compatible ? 1 : 0);
    }
  );

  test.each([
    "restore",
    "changed-current",
    "changed-account",
    "changed-script",
  ])("handles %s", async (scenario) => {
    await writeFile(
      recordFile,
      JSON.stringify({
        account: scenario === "changed-account" ? "b".repeat(32) : account,
        buildId: "healthy-build",
        release,
        script: scenario === "changed-script" ? "other" : "web",
        version: previous,
      })
    );
    const restore = recoverWeb({
      account,
      expectedVersion: scenario === "changed-current" ? previous : version,
      mode: "restore",
      recordFile,
      token: "test",
    });
    if (scenario === "restore") {
      await expect(restore).rejects.toThrow(
        "predates the personal Action protocol"
      );
    } else {
      await expect(restore).rejects.toThrow("changed");
    }
    expect(mutations).toHaveLength(0);
  });
});
