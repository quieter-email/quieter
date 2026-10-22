import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DEPLOYMENT_STATUS_PATH,
  deploymentStatusSchema,
  webReleasePlanSchema,
} from "@quieter/env/deployment";
import type { z } from "zod";

const readWebRelease = async (origin: string) => {
  const options = {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  } as const;
  const [response, marker] = await Promise.all([
    fetch(new URL(DEPLOYMENT_STATUS_PATH, origin), options),
    fetch(new URL("/assets/build-id.txt", origin), options),
  ]);
  let deployment: z.infer<typeof deploymentStatusSchema> | null = null;
  if (response.status !== 404) {
    if (
      !response.ok ||
      response.headers.get("content-type")?.includes("application/json") !==
        true
    ) {
      throw new Error("Cannot read the active web deployment.");
    }
    deployment = deploymentStatusSchema.parse(await response.json());
  }
  let sourceBuildId = null;
  if (marker.status !== 404) {
    if (!marker.ok) {
      throw new Error("Cannot read the current web release marker.");
    }
    const contentType = marker.headers.get("content-type") ?? "";
    if (contentType.includes("text/plain")) {
      const markerText = await marker.text();
      sourceBuildId = webReleasePlanSchema.shape.sourceBuildId.parse(
        markerText.trim()
      );
    } else if (!contentType.includes("text/html")) {
      throw new Error(
        "The current web release marker has an unexpected format."
      );
    }
  }
  if (deployment !== null && sourceBuildId !== deployment.current.buildId) {
    throw new Error(
      "The web deployment changed while reading its release marker."
    );
  }
  return { deployment, sourceBuildId };
};

export const prepareWebRelease = async (input: {
  origin: string;
  buildId: string;
  planFile: string;
}) => {
  const { origin, buildId, planFile } = input;
  const { deployment: previous, sourceBuildId } = await readWebRelease(origin);
  let updateSlot: "a" | "b" | null = previous?.current.slot === "a" ? "b" : "a";
  if (previous?.current.buildId === buildId) {
    updateSlot = null;
  }
  const manifest =
    updateSlot === null && previous !== null
      ? { current: previous.current, previous: previous.previous }
      : {
          current: { buildId, slot: updateSlot },
          previous:
            previous === null
              ? null
              : {
                  ...previous.current,
                  expiresAt: previous.serverTime + 12 * 60 * 60 * 1000,
                },
        };
  const plan = webReleasePlanSchema.parse({
    manifest,
    sourceBuildId,
    updateSlot,
  });
  await mkdir(path.dirname(planFile), { recursive: true });
  await writeFile(planFile, JSON.stringify(plan), { flag: "wx" });
  process.stdout.write(
    `Prepared web release ${plan.manifest.current.buildId} in slot ${plan.manifest.current.slot}.\n`
  );
};

export const verifyWebRelease = async (input: {
  origin: string;
  buildId: string;
  planFile: string;
}) => {
  const plan = webReleasePlanSchema.parse(
    JSON.parse(await readFile(input.planFile, "utf-8"))
  );
  if (plan.manifest.current.buildId !== input.buildId) {
    throw new Error("The prepared web routing belongs to another build.");
  }
  const { deployment, sourceBuildId } = await readWebRelease(input.origin);
  const expected =
    plan.updateSlot === null ? plan.manifest.current : plan.manifest.previous;
  if (
    sourceBuildId !== plan.sourceBuildId ||
    (deployment === null
      ? expected !== null
      : expected === null ||
        deployment.current.buildId !== expected.buildId ||
        deployment.current.slot !== expected.slot)
  ) {
    throw new Error(
      "The active web deployment changed after preparation. Start a fresh deployment before applying migrations."
    );
  }
  process.stdout.write("The captured web predecessor is still active.\n");
};

if (import.meta.main) {
  const [mode, origin, buildId, planFile = ".sst/web-deployment.json"] =
    process.argv.slice(2);
  if (!origin || !buildId || (mode !== "prepare" && mode !== "verify")) {
    throw new Error(
      "Usage: web-release.ts prepare|verify <origin> <build-id> [plan-file]"
    );
  }
  if (mode === "prepare") {
    await prepareWebRelease({ buildId, origin, planFile });
  } else {
    await verifyWebRelease({ buildId, origin, planFile });
  }
}
