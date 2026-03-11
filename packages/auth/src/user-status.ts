import { db, tables } from "@quietr/database";
import { eq, sql } from "drizzle-orm";

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const getAuthUserStatus = async (email: string) => {
  const normalizedEmail = normalizeEmail(email);

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
    .where(eq(tables.user.email, normalizedEmail))
    .limit(1);

  return {
    email: normalizedEmail,
    exists: result?.exists ?? false,
    hasGoogleAccount: result?.hasGoogleAccount ?? false,
  };
};
