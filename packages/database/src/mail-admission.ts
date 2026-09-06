import { and, eq, sql } from "drizzle-orm";

import type { DatabaseClient } from "./client.ts";
import { mailAdmissionGate, mailSubmission } from "./schema.ts";

export type MailAdmissionLimits = {
  global: { maxPending: number; maxPendingBytes: number };
  organization: { maxPending: number; maxPendingBytes: number };
  maxQueuedAgeSeconds: number;
};

export class MailAdmissionCapacityError extends Error {
  constructor() {
    super(
      "Message acceptance is temporarily at capacity. Retry with the same idempotency key."
    );
    this.name = "MailAdmissionCapacityError";
  }
}

export const assertMailAdmissionCapacity = async (
  transaction: Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0],
  input: {
    organizationId: string;
    payloadBytes: number;
    limits: MailAdmissionLimits;
  }
) => {
  const { limits } = input;
  if (
    !Number.isSafeInteger(input.payloadBytes) ||
    input.payloadBytes < 0 ||
    !Number.isSafeInteger(limits.maxQueuedAgeSeconds) ||
    limits.maxQueuedAgeSeconds < 60 ||
    limits.maxQueuedAgeSeconds > 604_800 ||
    [limits.global, limits.organization].some(
      (limit) =>
        !Number.isInteger(limit.maxPending) ||
        limit.maxPending < 1 ||
        limit.maxPending > 10_000 ||
        !Number.isSafeInteger(limit.maxPendingBytes) ||
        limit.maxPendingBytes < 1
    )
  ) {
    throw new Error("Invalid bounded mail admission limits.");
  }
  // Every new acceptance shares this short database-only section; concurrent tenants cannot overfill the global cap.
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
    const limit = limits[scope];
    const pending = transaction
      .select({
        acceptedAt: mailSubmission.acceptedAt,
        attachmentBytes: mailSubmission.attachmentBytes,
        messageBytes: mailSubmission.messageBytes,
        status: mailSubmission.status,
      })
      .from(mailSubmission)
      .where(
        and(
          sql`${mailSubmission.status} IN ('queued', 'dispatching', 'pending_confirmation')`,
          scope === "organization"
            ? eq(mailSubmission.organizationId, input.organizationId)
            : undefined
        )
      )
      .orderBy(mailSubmission.acceptedAt, mailSubmission.id)
      .limit(limit.maxPending)
      .as("pending_admission");
    // oxlint-disable-next-line no-await-in-loop -- Each indexed aggregate examines at most the configured count cap.
    const [usage] = await transaction
      .select({
        bytes:
          sql`coalesce(sum(${pending.messageBytes}::bigint + ${pending.attachmentBytes}::bigint), 0)`.mapWith(
            Number
          ),
        count: sql`count(*)`.mapWith(Number),
        queuedAgeSeconds:
          sql`coalesce(extract(epoch from (clock_timestamp() - min(case when ${pending.status} IN ('queued', 'dispatching') then ${pending.acceptedAt} end))), 0)`.mapWith(
            Number
          ),
      })
      .from(pending);
    if (
      usage.count >= limit.maxPending ||
      usage.bytes + input.payloadBytes > limit.maxPendingBytes ||
      usage.queuedAgeSeconds >= limits.maxQueuedAgeSeconds
    ) {
      throw new MailAdmissionCapacityError();
    }
  }
};
