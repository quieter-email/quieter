import { setTimeout } from "node:timers/promises";

import { z } from "zod";

import type { HealthEvidence, ReleaseAttempt } from "./schema.ts";
import { identifierSchema } from "./schema.ts";

export const probeConfigurationSchema = z.record(
  identifierSchema,
  z.strictObject({
    checks: z.array(identifierSchema).min(1),
    url: z.url().refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.username === "" &&
        url.password === "" &&
        url.hash === ""
      );
    }),
  })
);

export const observeRelease = async (
  attempt: ReleaseAttempt,
  configuration: z.infer<typeof probeConfigurationSchema>,
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
      (service) => !Object.hasOwn(probes, service.service)
    )
  ) {
    throw new Error("Every service needs a configured health probe.");
  }
  const evidence: HealthEvidence = {
    attemptId: attempt.id,
    finishedAt: new Date().toISOString(),
    services: {},
    startedAt: new Date().toISOString(),
  };
  for (let round = 0; round < 13; round += 1) {
    if (round > 0) {
      // oxlint-disable-next-line no-await-in-loop -- Observe real time rather than repeatedly sampling one instant.
      await pause(10_000);
    }
    if (Date.now() >= Date.parse(attempt.deadline)) {
      throw new Error("Health observation exceeded the release deadline.");
    }
    // oxlint-disable-next-line no-unreachable-loop -- The inner stream loop exits on EOF; observation continues with every service.
    for (const service of attempt.candidate.services) {
      const probe = probes[service.service];
      // oxlint-disable-next-line no-await-in-loop -- Bound request pressure; every response must identify the actual running version.
      const response = await fetch(probe.url, {
        headers: {
          authorization: `Bearer ${token}`,
          "cache-control": "no-cache",
        },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (
        !response.ok ||
        Number(response.headers.get("content-length") ?? 0) > 4096
      ) {
        // oxlint-disable-next-line no-await-in-loop -- Release the failed response before stopping observation.
        await response.body?.cancel();
        throw new Error(`Health probe failed for ${service.service}.`);
      }
      const reader = response.body?.getReader();
      if (reader === undefined) {
        throw new Error("Health probe returned an empty response.");
      }
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          // oxlint-disable-next-line no-await-in-loop -- Enforce the byte limit while consuming chunked responses.
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
        // oxlint-disable-next-line no-await-in-loop -- Stop an oversized stream before leaving observation.
        await reader.cancel();
        reader.releaseLock();
      }
      const text = Buffer.concat(chunks).toString("utf-8");
      const result = z
        .strictObject({
          checks: z.record(identifierSchema, z.boolean()),
          versionId: z.uuid(),
        })
        .safeParse(JSON.parse(text));
      if (
        !result.success ||
        result.data.versionId !== service.versionId ||
        probe.checks.some((check) => !result.data.checks[check])
      ) {
        throw new Error(
          `Health probe returned an invalid result for ${service.service}.`
        );
      }
      evidence.services[service.service] = {
        failures: 0,
        samples: round + 1,
        versionId: service.versionId,
      };
    }
  }
  evidence.finishedAt = new Date().toISOString();
  return evidence;
};
