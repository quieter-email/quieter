import { setTimeout } from "node:timers/promises";

import { z } from "zod";

import type {
  HealthyRelease,
  HealthEvidence,
  ReleaseAttempt,
} from "./schema.ts";
import { identifierSchema, probeConfigurationSchema } from "./schema.ts";

export const createReleaseProbes = (
  baseline: HealthyRelease,
  candidate: HealthyRelease,
  configuration: unknown
) => {
  const targets = z
    .record(
      identifierSchema,
      z.strictObject({
        checks: z.array(identifierSchema).min(1),
        criticalChecks: z.array(identifierSchema).default([]),
        previewUrl: z.url(),
        url: z.url(),
      })
    )
    .parse(configuration);
  const probes: z.input<typeof probeConfigurationSchema> = {};
  for (const service of candidate.services) {
    const previous = baseline.services.find(
      (entry) => entry.service === service.service
    );
    const target = targets[service.service];
    if (previous === undefined || target === undefined) {
      throw new Error(
        "Every runtime requires a baseline and reviewed probe target."
      );
    }
    const preview = new URL(target.previewUrl);
    if (
      preview.protocol !== "https:" ||
      preview.port !== "" ||
      preview.username !== "" ||
      preview.password !== "" ||
      preview.search !== "" ||
      preview.hash !== "" ||
      preview.hostname.split(".").length !== 4 ||
      !preview.hostname.endsWith(".workers.dev") ||
      preview.hostname.split(".")[0] !== service.scriptName ||
      previous.scriptName !== service.scriptName
    ) {
      throw new Error(
        "Preview targets must identify the recorded Worker's canonical workers.dev URL."
      );
    }
    const baselineUrl = new URL(preview);
    baselineUrl.hostname = `${previous.versionId.slice(0, 8)}-${preview.hostname}`;
    const candidateUrl = new URL(preview);
    candidateUrl.hostname = `${service.versionId.slice(0, 8)}-${preview.hostname}`;
    probes[service.service] = {
      baselineUrl: baselineUrl.href,
      candidateUrl: candidateUrl.href,
      checks: target.checks,
      criticalChecks: target.criticalChecks,
      url: target.url,
    };
  }
  return probeConfigurationSchema.parse(probes);
};

const sampleHealth = async (
  url: string,
  versionId: string,
  probe: z.infer<typeof probeConfigurationSchema>[string],
  token: string
) => {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      "cache-control": "no-cache",
    },
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (response === null) {
    return false;
  }
  if (!response.ok) {
    await response.body?.cancel();
    return false;
  }
  if (Number(response.headers.get("content-length") ?? 0) > 4096) {
    await response.body?.cancel();
    throw new Error("Health probe exceeded the response limit.");
  }
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new Error("Health probe returned an empty response.");
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      // oxlint-disable-next-line no-await-in-loop -- Bound chunked responses while consuming them.
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > 4096) {
        throw new Error("Health probe exceeded the response limit.");
      }
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    throw new Error("Health probe returned an invalid result.");
  }
  const result = z
    .strictObject({
      checks: z.record(identifierSchema, z.boolean()),
      versionId: z.uuid(),
    })
    .safeParse(body);
  if (
    !result.success ||
    result.data.versionId !== versionId ||
    probe.checks.some((check) => !Object.hasOwn(result.data.checks, check))
  ) {
    throw new Error(
      "Health probe returned an invalid result or version identity."
    );
  }
  if (probe.criticalChecks.some((check) => !result.data.checks[check])) {
    throw new Error("A critical release safety check failed.");
  }
  return probe.checks.every((check) => result.data.checks[check]);
};

export const verifyReleaseHealth = async (
  release: HealthyRelease,
  configuration: z.input<typeof probeConfigurationSchema> | undefined,
  token: string | undefined,
  target: "candidateUrl" | "url",
  pause: (milliseconds: number) => Promise<void> = setTimeout
) => {
  if (configuration === undefined || token === undefined || token.length < 32) {
    throw new Error(
      "Release verification requires recorded probes and the linked probe secret."
    );
  }
  const probes = probeConfigurationSchema.parse(configuration);
  if (
    release.services.some((service) => !Object.hasOwn(probes, service.service))
  ) {
    throw new Error("Every service needs a configured health probe.");
  }
  for (let round = 0; round < 3; round += 1) {
    if (round > 0) {
      // oxlint-disable-next-line no-await-in-loop -- Require consecutive samples over time before accepting a pointer change.
      await pause(10_000);
    }
    for (const service of release.services) {
      const probe = probes[service.service];
      // oxlint-disable-next-line no-await-in-loop -- Check the exact candidate or restored baseline on every service.
      const passed = await sampleHealth(
        probe[target],
        service.versionId,
        probe,
        token
      );
      if (!passed) {
        throw new Error(
          `Release health verification failed for ${service.service}.`
        );
      }
    }
  }
};

export const observeRelease = async (
  attempt: ReleaseAttempt,
  configuration: z.input<typeof probeConfigurationSchema>,
  token: string,
  pause: (milliseconds: number) => Promise<void> = setTimeout
) => {
  if (attempt.status !== "observing" || token.length < 32) {
    throw new Error(
      "Health observation requires an activated attempt and protected probes."
    );
  }
  const probes = probeConfigurationSchema.parse(configuration);
  if (
    attempt.candidate.services.some(
      (service) =>
        !Object.hasOwn(probes, service.service) ||
        !attempt.baseline.services.some(
          (baseline) => baseline.service === service.service
        )
    )
  ) {
    throw new Error(
      "Every service needs a configured health probe and baseline."
    );
  }
  const evidence: HealthEvidence = {
    attemptId: attempt.id,
    finishedAt: new Date().toISOString(),
    services: {},
    startedAt: new Date().toISOString(),
  };
  const failures: Record<string, number> = {};
  let healthyRounds = 0;
  let rounds = 0;
  while (healthyRounds < 13) {
    if (rounds > 0) {
      // oxlint-disable-next-line no-await-in-loop -- Sample over time with bounded pressure.
      await pause(10_000);
    }
    rounds += 1;
    if (Date.now() >= Date.parse(attempt.deadline)) {
      throw new Error(
        "Health observation exceeded the release deadline without a healthy window."
      );
    }
    const startedAt = new Date().toISOString();
    let healthy = true;
    for (const service of attempt.candidate.services) {
      const probe = probes[service.service];
      // oxlint-disable-next-line no-await-in-loop -- Identify the running version on every request.
      const passed = await sampleHealth(
        probe.url,
        service.versionId,
        probe,
        token
      );
      failures[service.service] = passed
        ? 0
        : (failures[service.service] ?? 0) + 1;
      if (!passed) {
        healthy = false;
        const baseline = attempt.baseline.services.find(
          (entry) => entry.service === service.service
        );
        if (!baseline) {
          throw new Error("Missing baseline health identity.");
        }
        // oxlint-disable-next-line no-await-in-loop -- Distinguish a candidate regression from a shared dependency failure.
        const controlPassed = await sampleHealth(
          probe.baselineUrl,
          baseline.versionId,
          probe,
          token
        );
        if (failures[service.service] >= 3 && controlPassed) {
          throw new Error(
            `Confirmed release regression for ${service.service}: three consecutive failures with a healthy baseline.`
          );
        }
      }
    }
    if (!healthy) {
      healthyRounds = 0;
      evidence.services = {};
      continue;
    }
    if (healthyRounds === 0) {
      evidence.startedAt = startedAt;
    }
    healthyRounds += 1;
    const samples = healthyRounds;
    evidence.services = Object.fromEntries(
      attempt.candidate.services.map((service) => [
        service.service,
        {
          failures: 0 as const,
          samples,
          versionId: service.versionId,
        },
      ])
    );
  }
  evidence.finishedAt = new Date().toISOString();
  return evidence;
};
