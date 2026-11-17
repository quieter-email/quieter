import { db } from "@quieter/database/client";
import { rateLimitBucket } from "@quieter/database/schema";
import { inArray, lt, lte, sql } from "drizzle-orm";

export const cleanupRateLimitBuckets = async () => {
  const removed = await db
    .delete(rateLimitBucket)
    .where(
      inArray(
        rateLimitBucket.key,
        db
          .select({ key: rateLimitBucket.key })
          .from(rateLimitBucket)
          .where(lt(rateLimitBucket.expiresAt, new Date()))
          .orderBy(rateLimitBucket.expiresAt)
          .limit(5000)
          .for("update", { skipLocked: true })
      )
    )
    .returning({ key: rateLimitBucket.key });
  return { deleted: removed.length };
};

export const consumeRateLimit = async (input: {
  cost?: number;
  key: string;
  limit: number;
  windowMs: number;
}) => {
  const cost = input.cost ?? 1;
  if (!Number.isSafeInteger(cost) || cost < 1) {
    throw new RangeError("Rate limit cost must be a positive integer.");
  }
  const chargedCost = Math.min(cost, input.limit + 1);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.windowMs);
  const nowValue = now.toISOString();
  const expiresAtValue = expiresAt.toISOString();
  const isExpired = lte(rateLimitBucket.expiresAt, now);
  const [bucket] = await db
    .insert(rateLimitBucket)
    .values({
      count: chargedCost,
      expiresAt,
      key: input.key,
      windowStart: now,
    })
    .onConflictDoUpdate({
      set: {
        count: sql`case when ${isExpired} then ${chargedCost} else least(${rateLimitBucket.count}::bigint + ${chargedCost}, ${input.limit + 1}) end`,
        expiresAt: sql`case when ${isExpired} then ${expiresAtValue} else ${rateLimitBucket.expiresAt} end`,
        windowStart: sql`case when ${isExpired} then ${nowValue} else ${rateLimitBucket.windowStart} end`,
      },
      target: rateLimitBucket.key,
    })
    .returning({
      count: rateLimitBucket.count,
      expiresAt: rateLimitBucket.expiresAt,
    });

  return {
    allowed: bucket !== undefined && bucket.count <= input.limit,
    remaining: Math.max(0, input.limit - (bucket?.count ?? input.limit)),
    resetAt: bucket?.expiresAt ?? expiresAt,
  };
};
