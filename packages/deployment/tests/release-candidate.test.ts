import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import { assembleReleaseCandidate } from "../src/git-release-plan.ts";
import type { HealthyRelease } from "../src/schema.ts";
import type { UploadReceipt } from "../src/upload.ts";

const baseline: HealthyRelease = {
  id: "healthy",
  services: ["web", "mail-api"].map((service) => ({
    artifactDigest: "a".repeat(64),
    bindingGeneration: "b".repeat(64),
    contracts: ["v1"],
    requirements: {},
    scriptName: `quieter-proof-${service}`,
    service,
    versionId: randomUUID(),
  })),
  sourceSha: "c".repeat(40),
};
const receipt: UploadReceipt = {
  intent: {
    artifactDigest: "d".repeat(64),
    baseline: { id: randomUUID(), versionId: baseline.services[0].versionId },
    createdAt: "2026-09-06T20:00:00.000Z",
    id: randomUUID(),
    scriptName: baseline.services[0].scriptName,
    workflowRunId: "269",
  },
  versionId: randomUUID(),
};
const input = {
  baseline,
  id: "candidate",
  receipts: [receipt],
  sourceSha: "e".repeat(40),
};

describe("release candidate assembly", () => {
  it("replaces only uploaded versions and preserves the complete healthy contract and binding map", () => {
    const candidate = assembleReleaseCandidate(input);
    expect(candidate).toStrictEqual({
      id: input.id,
      services: [
        {
          ...baseline.services[0],
          artifactDigest: receipt.intent.artifactDigest,
          versionId: receipt.versionId,
        },
        baseline.services[1],
      ],
      sourceSha: input.sourceSha,
    });
    expect(baseline.services[0].artifactDigest).toBe("a".repeat(64));
  });

  it.each([
    { receipts: [] },
    { receipts: [receipt, receipt] },
    {
      receipts: [
        { ...receipt, intent: { ...receipt.intent, scriptName: "unknown" } },
      ],
    },
  ])("rejects missing, repeated, and unrelated uploads", ({ receipts }) => {
    expect(() => assembleReleaseCandidate({ ...input, receipts })).toThrow(
      "one retained upload"
    );
  });

  it("rejects uploads made against a different baseline", () => {
    expect(() =>
      assembleReleaseCandidate({
        ...input,
        receipts: [
          {
            ...receipt,
            intent: {
              ...receipt.intent,
              baseline: { id: randomUUID(), versionId: randomUUID() },
            },
          },
        ],
      })
    ).toThrow("current healthy version");
  });

  it("rejects a receipt that selects the existing version", () => {
    expect(() =>
      assembleReleaseCandidate({
        ...input,
        receipts: [{ ...receipt, versionId: baseline.services[0].versionId }],
      })
    ).toThrow("current healthy version");
  });
});
