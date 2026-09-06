import { and, eq, gte, lt, ne, or, sql } from "drizzle-orm";

import type { DatabaseClient } from "./client.ts";
import { mailSendAttempt, mailSendCapacity } from "./schema.ts";

type LedgerTransaction = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];

export class MailSendCapacityUnavailableError extends Error {
  readonly retryAt: Date;
  readonly code:
    | "provider_capacity_stale"
    | "provider_capacity_exhausted"
    | "provider_rate_limited";

  constructor(code: MailSendCapacityUnavailableError["code"], retryAt: Date) {
    super("Mail sending capacity is temporarily unavailable.");
    this.name = "MailSendCapacityUnavailableError";
    this.code = code;
    this.retryAt = retryAt;
  }
}

export const storeMailSendCapacity = async (
  database: DatabaseClient,
  input: {
    accountId: string;
    region: string;
    max24HourSend: number;
    maxSendRate: number;
    sentLast24Hours: number;
    observedAt: Date;
    sendingEnabled: boolean;
  }
) => {
  if (
    !/^\d{12}$/u.test(input.accountId) ||
    !/^[a-z]{2}(?:-[a-z]+)+-\d$/u.test(input.region) ||
    ![input.max24HourSend, input.sentLast24Hours].every(
      (value) => Number.isSafeInteger(value) && value >= 0
    ) ||
    !Number.isFinite(input.maxSendRate) ||
    input.maxSendRate < 0 ||
    input.maxSendRate > Number.MAX_SAFE_INTEGER ||
    !Number.isFinite(input.observedAt.getTime()) ||
    input.observedAt.getTime() > Date.now() + 1000
  ) {
    throw new Error("Invalid regional send capacity observation.");
  }
  const key = `${input.accountId}:${input.region}`;
  const snapshot = {
    max24HourSend: input.max24HourSend,
    maxSendRate: input.maxSendRate,
    observedAt: input.observedAt,
    sendingEnabled: input.sendingEnabled,
    sentLast24Hours: input.sentLast24Hours,
  };
  await database
    .insert(mailSendCapacity)
    .values({ ...snapshot, key, nextSendAt: sql`now()`, region: input.region })
    .onConflictDoUpdate({
      set: snapshot,
      setWhere: lt(mailSendCapacity.observedAt, input.observedAt),
      target: mailSendCapacity.key,
    });
  return key;
};

export const reserveMailSendCapacity = async (
  transaction: LedgerTransaction,
  input: { key: string; region: string; recipientCount: number }
) => {
  if (
    !Number.isInteger(input.recipientCount) ||
    input.recipientCount < 1 ||
    input.recipientCount > 50
  ) {
    throw new Error("Invalid send capacity reservation.");
  }
  const [capacity] = await transaction
    .select()
    .from(mailSendCapacity)
    .where(eq(mailSendCapacity.key, input.key))
    .for("update");
  const [clock] = await transaction
    .select({
      milliseconds:
        sql`floor(extract(epoch from clock_timestamp()) * 1000)`.mapWith(
          Number
        ),
    })
    .from(sql`(SELECT 1) AS clock`);
  const now = new Date(clock.milliseconds);
  if (
    capacity === undefined ||
    capacity.region !== input.region ||
    now.getTime() - capacity.observedAt.getTime() > 60_000 ||
    capacity.observedAt.getTime() > now.getTime() + 1000
  ) {
    throw new MailSendCapacityUnavailableError(
      "provider_capacity_stale",
      new Date(now.getTime() + 30_000)
    );
  }
  if (!capacity.sendingEnabled || capacity.maxSendRate <= 0) {
    throw new MailSendCapacityUnavailableError(
      "provider_capacity_exhausted",
      new Date(now.getTime() + 60_000)
    );
  }
  if (capacity.nextSendAt > now) {
    throw new MailSendCapacityUnavailableError(
      "provider_rate_limited",
      capacity.nextSendAt
    );
  }
  const [usage] = await transaction
    .select({
      recipients:
        sql`coalesce(sum(${mailSendAttempt.recipientCount}), 0)`.mapWith(
          Number
        ),
    })
    .from(mailSendAttempt)
    .where(
      and(
        eq(mailSendAttempt.capacityKey, input.key),
        ne(mailSendAttempt.outcome, "rejected"),
        gte(mailSendAttempt.intentAt, new Date(now.getTime() - 86_460_000)),
        or(
          ne(mailSendAttempt.outcome, "accepted"),
          gte(mailSendAttempt.completedAt, capacity.observedAt)
        )
      )
    );
  const projected =
    capacity.sentLast24Hours + (usage?.recipients ?? 0) + input.recipientCount;
  if (!Number.isSafeInteger(projected) || projected > capacity.max24HourSend) {
    throw new MailSendCapacityUnavailableError(
      "provider_capacity_exhausted",
      new Date(now.getTime() + 60_000)
    );
  }
  await transaction
    .update(mailSendCapacity)
    .set({
      nextSendAt: new Date(
        now.getTime() +
          Math.ceil(
            (input.recipientCount / (capacity.maxSendRate * 0.8)) * 1000
          )
      ),
    })
    .where(eq(mailSendCapacity.key, input.key));
};
