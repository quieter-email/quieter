import { createHash, randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import type { DatabaseClient } from "./client.ts";
import { canonicalMailJson } from "./mail-ledger-json.ts";
import { mailFeedbackInbox } from "./schema.ts";

export const retainMailFeedback = async (
  database: DatabaseClient,
  input: {
    source: string;
    region: string;
    providerEventId: string;
    providerMessageId: string | null;
    schemaVersion: number;
    payload: Record<string, unknown>;
  }
) => {
  if (
    input.source.length === 0 ||
    input.source.length > 512 ||
    !/^[\w-]{1,128}$/u.test(input.providerEventId) ||
    !/^[a-z]{2}(?:-[a-z]+)+-\d$/u.test(input.region) ||
    !Number.isInteger(input.schemaVersion) ||
    input.schemaVersion < 1
  ) {
    throw new Error("Invalid authenticated feedback identity.");
  }
  const payload = canonicalMailJson(input.payload);
  if (Buffer.byteLength(payload) > 128 * 1024) {
    throw new Error("Feedback exceeds the bounded inbox size.");
  }
  const digest = createHash("sha256").update(payload).digest("hex");
  return await database.transaction(async (transaction) => {
    const [created] = await transaction
      .insert(mailFeedbackInbox)
      .values({
        ...input,
        dueAt: sql`now()`,
        id: randomUUID(),
        payloadDigest: digest,
        receivedAt: sql`now()`,
      })
      .onConflictDoNothing({
        target: [
          mailFeedbackInbox.source,
          mailFeedbackInbox.region,
          mailFeedbackInbox.providerEventId,
        ],
      })
      .returning({ id: mailFeedbackInbox.id });
    if (created !== undefined) {
      return { id: created.id, replayed: false };
    }
    const [existing] = await transaction
      .select()
      .from(mailFeedbackInbox)
      .where(
        and(
          eq(mailFeedbackInbox.source, input.source),
          eq(mailFeedbackInbox.region, input.region),
          eq(mailFeedbackInbox.providerEventId, input.providerEventId)
        )
      )
      .limit(1);
    if (
      existing === undefined ||
      existing.payloadDigest !== digest ||
      existing.schemaVersion !== input.schemaVersion ||
      existing.providerMessageId !== input.providerMessageId
    ) {
      throw new Error("Feedback identity conflicts with retained content.");
    }
    return { id: existing.id, replayed: true };
  });
};
