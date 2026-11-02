import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import type { DatabaseTransaction } from "@quieter/database/client";
import { mailDomain } from "@quieter/database/schema";
import { and, eq, isNotNull, or, sql } from "drizzle-orm";

export const withMailDomainLock = async <Result>(
  domain: string,
  run: (database: DatabaseTransaction) => Promise<Result>
) =>
  await db.transaction(async (database) => {
    // The identity and routing rules are shared by every pending claim.
    await database.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${domain}, 0))`
    );
    return await run(database);
  });

export const assertMailDomainOwnerAvailable = async (input: {
  database: DatabaseTransaction;
  domain: string;
  organizationId: string;
}) => {
  const [owner] = await input.database
    .select({ organizationId: mailDomain.organizationId })
    .from(mailDomain)
    .where(
      and(
        eq(mailDomain.domain, input.domain),
        or(
          isNotNull(mailDomain.ownershipVerifiedAt),
          eq(mailDomain.status, "verified")
        )
      )
    )
    .limit(1);
  if (owner !== undefined && owner.organizationId !== input.organizationId) {
    throw new ORPCError("CONFLICT", {
      message: "This domain is already verified by another team.",
    });
  }
};
