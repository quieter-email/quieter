import { z } from "zod";

const admissionScope = z.strictObject({
  maxPending: z.number().int().min(1).max(10_000),
  maxPendingBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

const storageScope = z.strictObject({
  maxPayloadBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  maxPayloadUploads: z.number().int().min(1).max(10_000),
  maxSubmissionBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  maxSubmissions: z.number().int().min(1).max(10_000),
});

const configuration = z.strictObject({
  acceptanceEnabled: z.boolean(),
  limits: z.strictObject({
    global: admissionScope,
    maxQueuedAgeSeconds: z.number().int().min(60).max(604_800),
    organization: admissionScope,
  }),
  organizationIds: z.array(z.string().min(1).max(128)).min(1).max(100),
  schemaVersion: z.literal(1),
  storageLimits: z.strictObject({
    global: storageScope,
    organization: storageScope,
  }),
});

export const createMailApiEnv = (runtime: {
  QUIETER_MAIL_API_CONFIG?: string;
}) => {
  if (
    runtime.QUIETER_MAIL_API_CONFIG === undefined ||
    runtime.QUIETER_MAIL_API_CONFIG === ""
  ) {
    return null;
  }
  try {
    return configuration.parse(JSON.parse(runtime.QUIETER_MAIL_API_CONFIG));
  } catch {
    throw new Error("Invalid mail API configuration.");
  }
};
