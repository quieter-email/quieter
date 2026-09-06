import { randomUUID } from "node:crypto";

import { and, eq, inArray, lte, ne, sql } from "drizzle-orm";

import type { DatabaseClient } from "./client.ts";
import { assertMailStorageCapacity } from "./mail-storage-capacity.ts";
import type { MailStorageLimits } from "./mail-storage-capacity.ts";
import { mailPayloadUpload, mailSubmission } from "./schema.ts";
import type { MailPayloadObject } from "./schema.ts";

export const createMailPayloadUpload = async (
  database: DatabaseClient,
  input: {
    organizationId: string;
    objects: Omit<MailPayloadObject, "key">[];
    limits: MailStorageLimits;
  }
) => {
  if (
    input.objects.length < 1 ||
    input.objects.length > 50 ||
    input.objects.some(
      (object) =>
        !Number.isSafeInteger(object.bytes) ||
        object.bytes < 1 ||
        !/^[a-f\d]{64}$/u.test(object.digest)
    ) ||
    input.objects.reduce((total, object) => total + object.bytes, 0) >
      25 * 1024 * 1024
  ) {
    throw new Error("Invalid bounded payload upload.");
  }
  return await database.transaction(async (transaction) => {
    await assertMailStorageCapacity(transaction, {
      bytes: input.objects.reduce((total, object) => total + object.bytes, 0),
      kind: "upload",
      limits: input.limits,
      organizationId: input.organizationId,
    });
    const id = randomUUID();
    const [upload] = await transaction
      .insert(mailPayloadUpload)
      .values({
        createdAt: sql`now()`,
        expiresAt: sql`now() + interval '10 minutes'`,
        id,
        nextActionAt: sql`now() + interval '10 minutes'`,
        objects: input.objects.map((object, index) => ({
          ...object,
          key: `submissions/${id}/${index}-${object.digest}`,
        })),
        organizationId: input.organizationId,
      })
      .returning();
    return upload;
  });
};

export const completeMailPayloadUpload = async (
  database: DatabaseClient,
  input: { id: string; organizationId: string }
) => {
  const [upload] = await database
    .update(mailPayloadUpload)
    .set({ status: "ready" })
    .where(
      and(
        eq(mailPayloadUpload.id, input.id),
        eq(mailPayloadUpload.organizationId, input.organizationId),
        eq(mailPayloadUpload.status, "uploading"),
        sql`${mailPayloadUpload.expiresAt} > clock_timestamp()`
      )
    )
    .returning();
  if (upload === undefined) {
    throw new Error("Payload upload expired or was fenced by cleanup.");
  }
  return upload;
};

export const cleanupMailPayloadUploads = async (
  database: DatabaseClient,
  input: { limit: number; remove: (key: string) => Promise<void> }
) => {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 20) {
    throw new Error("Invalid bounded payload cleanup batch.");
  }
  const claims = await database.transaction(async (transaction) => {
    const due = await transaction
      .select({ id: mailPayloadUpload.id })
      .from(mailPayloadUpload)
      .where(
        and(
          ne(mailPayloadUpload.status, "committed"),
          lte(mailPayloadUpload.nextActionAt, sql`now()`),
          lte(mailPayloadUpload.expiresAt, sql`now()`),
          sql`NOT EXISTS (SELECT 1 FROM ${mailSubmission} WHERE ${mailSubmission.payloadUploadId} = ${mailPayloadUpload.id})`
        )
      )
      .orderBy(mailPayloadUpload.nextActionAt, mailPayloadUpload.id)
      .limit(input.limit)
      .for("update", { skipLocked: true });
    if (due.length === 0) {
      return [];
    }
    return await transaction
      .update(mailPayloadUpload)
      .set({
        cleanupGeneration: sql`${mailPayloadUpload.cleanupGeneration} + 1`,
        nextActionAt: sql`now() + interval '5 minutes'`,
        status: "deleting",
      })
      .where(
        inArray(
          mailPayloadUpload.id,
          due.map((row) => row.id)
        )
      )
      .returning();
  });
  let cleaned = 0;
  for (const claim of claims) {
    // Retained tombstones revisit late storage writes; acceptance can never reclaim them.
    try {
      for (const object of claim.objects) {
        // oxlint-disable-next-line no-await-in-loop -- Bound storage concurrency and finish one manifest at a time.
        await input.remove(object.key);
      }
      // oxlint-disable-next-line no-await-in-loop -- Finish each claimed manifest independently.
      await database
        .update(mailPayloadUpload)
        .set({ nextActionAt: sql`now() + interval '1 day'` })
        .where(
          and(
            eq(mailPayloadUpload.id, claim.id),
            eq(mailPayloadUpload.status, "deleting"),
            eq(mailPayloadUpload.cleanupGeneration, claim.cleanupGeneration)
          )
        );
      cleaned += 1;
    } catch {
      // The claimed deadline makes a failed deletion retryable without exposing object keys.
    }
  }
  return { claimed: claims.length, cleaned };
};
