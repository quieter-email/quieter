import { z } from "zod";

export const identifierSchema = z.string().regex(/^[\w-]{1,128}$/u);
export const digestSchema = z.string().regex(/^[a-f\d]{64}$/u);

const probeUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.hash === ""
  );
});
export const probeConfigurationSchema = z.record(
  identifierSchema,
  z
    .strictObject({
      baselineUrl: probeUrlSchema,
      candidateUrl: probeUrlSchema,
      checks: z.array(identifierSchema).min(1),
      criticalChecks: z.array(identifierSchema).default([]),
      url: probeUrlSchema,
    })
    .refine(
      (probe) =>
        probe.criticalChecks.every((check) => probe.checks.includes(check)),
      "Critical checks must be part of the configured checks."
    )
);

export const serviceVersionSchema = z.strictObject({
  artifactDigest: digestSchema,
  bindingGeneration: digestSchema,
  contracts: z.array(identifierSchema),
  requirements: z.record(identifierSchema, z.array(identifierSchema)),
  scriptName: identifierSchema,
  service: identifierSchema,
  versionId: z.uuid(),
});

export const healthyReleaseSchema = z.strictObject({
  id: identifierSchema,
  services: z.array(serviceVersionSchema).min(1),
  sourceSha: z.string().regex(/^[a-f\d]{40}$/u),
});

export const activeDeploymentSchema = z.strictObject({
  id: z.uuid(),
  versionId: z.uuid(),
});

export const healthEvidenceSchema = z.strictObject({
  attemptId: identifierSchema,
  finishedAt: z.iso.datetime(),
  services: z.record(
    identifierSchema,
    z.strictObject({
      failures: z.literal(0),
      samples: z.number().int().min(13),
      versionId: z.uuid(),
    })
  ),
  startedAt: z.iso.datetime(),
});
export type HealthEvidence = z.infer<typeof healthEvidenceSchema>;

export const releaseAttemptSchema = z.strictObject({
  activatedServices: z.array(identifierSchema).default([]),
  baseline: healthyReleaseSchema,
  candidate: healthyReleaseSchema,
  deadline: z.iso.datetime(),
  deployments: z.record(identifierSchema, activeDeploymentSchema),
  failure: identifierSchema.nullable(),
  health: healthEvidenceSchema.nullable(),
  id: identifierSchema,
  intent: z
    .strictObject({
      expected: activeDeploymentSchema,
      service: identifierSchema,
      targetVersionId: z.uuid(),
    })
    .nullable(),
  mode: z.enum(["promote", "rollback"]),
  observationStartedAt: z.iso.datetime().nullable(),
  order: z.array(identifierSchema),
  probes: probeConfigurationSchema.optional(),
  status: z.enum([
    "prepared",
    "promoting",
    "observing",
    "healthy",
    "recovering",
    "rolled_back",
    "blocked",
  ]),
  workflowRunId: z.string().regex(/^\d+$/u),
});

export const releaseStateSchema = z.strictObject({
  attempt: releaseAttemptSchema.nullable(),
  healthy: healthyReleaseSchema,
  history: z.array(healthyReleaseSchema).max(100),
  quarantinedArtifacts: z.array(digestSchema),
  schemaVersion: z.literal(1),
  stage: identifierSchema,
});

export type ServiceVersion = z.infer<typeof serviceVersionSchema>;
export type HealthyRelease = z.infer<typeof healthyReleaseSchema>;
export type ActiveDeployment = z.infer<typeof activeDeploymentSchema>;
export type ReleaseAttempt = z.infer<typeof releaseAttemptSchema>;
export type ReleaseState = z.infer<typeof releaseStateSchema>;
export type Checkpoint = { revision: string; state: ReleaseState };

export type ReleaseJournal = {
  read: () => Promise<Checkpoint | null>;
  write: (revision: string | null, state: ReleaseState) => Promise<Checkpoint>;
};

export type RuntimeProvider = {
  active: (scriptName: string) => Promise<ActiveDeployment>;
  activate: (scriptName: string, versionId: string) => Promise<void>;
  verifyVersion: (scriptName: string, versionId: string) => Promise<void>;
};
