import { db, tables } from "@quieter/database";
import { eq, sql } from "drizzle-orm";

export const getAuthUserStatus = async (email: string) => {
  const [result] = await db
    .select({
      email: tables.user.email,
      exists: sql<boolean>`true`,
      hasGoogleAccount: sql<boolean>`exists (
        select 1
        from "account"
        where "account"."userId" = ${tables.user.id}
          and "account"."providerId" = 'google'
      )`,
    })
    .from(tables.user)
    .where(eq(tables.user.email, email.trim().toLowerCase()))
    .limit(1);

  return {
    email: email.trim().toLowerCase(),
    exists: result?.exists ?? false,
    hasGoogleAccount: result?.hasGoogleAccount ?? false,
  };
};
