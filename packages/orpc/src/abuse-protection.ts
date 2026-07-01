import { db } from "@quieter/database/client";
import { rateLimitBucket } from "@quieter/database/schema";
import { sql } from "drizzle-orm";

export const consumeRateLimit = async (input: { key: string; limit: number; windowMs: number }) => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.windowMs);
  const nowValue = now.toISOString();
  const expiresAtValue = expiresAt.toISOString();
  const [bucket] = await db
    .insert(rateLimitBucket)
    .values({
      count: 1,
      expiresAt,
      key: input.key,
      windowStart: now,
    })
    .onConflictDoUpdate({
      set: {
        count: sql`case when ${rateLimitBucket.expiresAt} <= ${nowValue} then 1 else ${rateLimitBucket.count} + 1 end`,
        expiresAt: sql`case when ${rateLimitBucket.expiresAt} <= ${nowValue} then ${expiresAtValue} else ${rateLimitBucket.expiresAt} end`,
        windowStart: sql`case when ${rateLimitBucket.expiresAt} <= ${nowValue} then ${nowValue} else ${rateLimitBucket.windowStart} end`,
      },
      target: rateLimitBucket.key,
    })
    .returning({
      count: rateLimitBucket.count,
      expiresAt: rateLimitBucket.expiresAt,
    });

  return {
    allowed: !!bucket && bucket.count <= input.limit,
    remaining: Math.max(0, input.limit - (bucket?.count ?? input.limit)),
    resetAt: bucket?.expiresAt ?? expiresAt,
  };
};
