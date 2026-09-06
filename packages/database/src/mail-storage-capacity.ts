import { eq, sql } from "drizzle-orm";

import type { DatabaseClient } from "./client.ts";
import {
  mailAdmissionGate,
  mailPayloadUpload,
  mailSubmission,
} from "./schema.ts";

export type MailStorageLimits = {
  global: {
    maxPayloadUploads: number;
    maxPayloadBytes: number;
    maxSubmissions: number;
    maxSubmissionBytes: number;
  };
  organization: {
    maxPayloadUploads: number;
    maxPayloadBytes: number;
    maxSubmissions: number;
    maxSubmissionBytes: number;
  };
};

export class MailStorageCapacityError extends Error {
  constructor() {
    super(
      "Message storage is temporarily at capacity. Retry with the same idempotency key."
    );
    this.name = "MailStorageCapacityError";
  }
}

export const assertMailStorageCapacity = async (
  transaction: Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0],
  input: {
    bytes: number;
    kind: "upload" | "submission";
    limits: MailStorageLimits;
    organizationId: string;
  }
) => {
  if (
    !Number.isSafeInteger(input.bytes) ||
    input.bytes < 0 ||
    [input.limits.global, input.limits.organization].some(
      (limit) =>
        [limit.maxPayloadUploads, limit.maxSubmissions].some(
          (value) => !Number.isInteger(value) || value < 1 || value > 10_000
        ) ||
        [limit.maxPayloadBytes, limit.maxSubmissionBytes].some(
          (value) => !Number.isSafeInteger(value) || value < 1
        )
    )
  ) {
    throw new Error("Invalid bounded mail storage limits.");
  }
  await transaction
    .insert(mailAdmissionGate)
    .values({ id: 1 })
    .onConflictDoNothing();
  await transaction
    .select({ id: mailAdmissionGate.id })
    .from(mailAdmissionGate)
    .where(eq(mailAdmissionGate.id, 1))
    .for("update");
  for (const scope of ["global", "organization"] as const) {
    const limit = input.limits[scope];
    if (input.kind === "upload") {
      const uploads = transaction
        .select({
          bytes:
            sql`(SELECT coalesce(sum((object->>'bytes')::bigint), 0) FROM jsonb_array_elements(${mailPayloadUpload.objects}) AS object)`
              .mapWith(Number)
              .as("bytes"),
        })
        .from(mailPayloadUpload)
        .where(
          scope === "organization"
            ? eq(mailPayloadUpload.organizationId, input.organizationId)
            : undefined
        )
        .orderBy(mailPayloadUpload.id)
        .limit(limit.maxPayloadUploads)
        .as("retained_uploads");
      // oxlint-disable-next-line no-await-in-loop -- Count every retained manifest, including cleaned tombstones that can receive late writes.
      const [usage] = await transaction
        .select({
          bytes: sql`coalesce(sum(${uploads.bytes}), 0)`.mapWith(Number),
          count: sql`count(*)`.mapWith(Number),
        })
        .from(uploads);
      if (
        !Number.isSafeInteger(usage.bytes) ||
        usage.bytes < 0 ||
        usage.count >= limit.maxPayloadUploads ||
        input.bytes > limit.maxPayloadBytes - usage.bytes
      ) {
        throw new MailStorageCapacityError();
      }
    } else {
      const submissions = transaction
        .select({
          bytes: mailSubmission.storageBytes,
        })
        .from(mailSubmission)
        .where(
          scope === "organization"
            ? eq(mailSubmission.organizationId, input.organizationId)
            : undefined
        )
        .orderBy(mailSubmission.id)
        .limit(limit.maxSubmissions)
        .as("retained_submissions");
      // oxlint-disable-next-line no-await-in-loop -- Terminal records continue consuming storage until a separate retention policy removes them.
      const [usage] = await transaction
        .select({
          bytes: sql`coalesce(sum(${submissions.bytes}), 0)`.mapWith(Number),
          count: sql`count(*)`.mapWith(Number),
        })
        .from(submissions);
      if (
        !Number.isSafeInteger(usage.bytes) ||
        usage.bytes < 0 ||
        usage.count >= limit.maxSubmissions ||
        input.bytes > limit.maxSubmissionBytes - usage.bytes
      ) {
        throw new MailStorageCapacityError();
      }
    }
  }
};
