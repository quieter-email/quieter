import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  PERSONAL_ACTION_PROTOCOL,
  webReleasePlanSchema,
} from "@quieter/env/deployment";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { deriveWebReleaseScope } from "../infra/web-release-scope.ts";
import { prepareWebRelease, verifyWebRelease } from "./web-release.ts";

let directory = "";

describe("web release protocol compatibility", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    if (directory !== "") {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test.each([undefined, PERSONAL_ACTION_PROTOCOL])(
    "captures predecessor without serving an incompatible protocol %s",
    async (protocol) => {
      directory = await mkdtemp(path.join(os.tmpdir(), "quieter-release-"));
      const planFile = path.join(directory, "plan.json");
      const status = {
        current: { buildId: "old", protocol, slot: "a" },
        previous: null,
        serverTime: Date.now(),
      };
      vi.stubGlobal(
        "fetch",
        vi.fn((url: URL) =>
          url.pathname.endsWith("build-id.txt")
            ? new Response(status.current.buildId, {
                headers: { "content-type": "text/plain" },
              })
            : Response.json(status)
        )
      );
      await prepareWebRelease({
        buildId: "new",
        origin: "https://example.invalid",
        planFile,
      });
      const plan = webReleasePlanSchema.parse(
        JSON.parse(await readFile(planFile, "utf-8"))
      );
      expect(plan.sourceDeployment).toMatchObject({
        buildId: "old",
        slot: "a",
      });
      expect(plan.manifest.current).toMatchObject({
        buildId: "new",
        protocol: PERSONAL_ACTION_PROTOCOL,
      });
      expect(plan.manifest.previous?.buildId ?? null).toBe(
        protocol === undefined ? null : "old"
      );
      expect(deriveWebReleaseScope(plan).kind).toBe(
        protocol === undefined ? "bootstrap" : "advance"
      );
      await expect(
        verifyWebRelease({
          buildId: "new",
          origin: "https://example.invalid",
          planFile,
        })
      ).resolves.toBeUndefined();
      status.current.buildId = "drifted";
      await expect(
        verifyWebRelease({
          buildId: "new",
          origin: "https://example.invalid",
          planFile,
        })
      ).rejects.toThrow("changed after preparation");
    }
  );
});
