import { db } from "@quieter/database/client";
import { tables } from "@quieter/database/schema";
import { and, eq, exists } from "drizzle-orm";

export const getAuthUserStatus = async (email: string) => {
  const [result] = await db
    .select({
      hasGoogleAccount: exists(
        db
          .select({ id: tables.account.id })
          .from(tables.account)
          .where(
            and(
              eq(tables.account.userId, tables.user.id),
              eq(tables.account.providerId, "google")
            )
          )
      ).mapWith(Boolean),
    })
    .from(tables.user)
    .where(eq(tables.user.email, email.trim().toLowerCase()))
    .limit(1);

  return {
    email: email.trim().toLowerCase(),
    exists: result !== undefined,
    hasGoogleAccount: result?.hasGoogleAccount ?? false,
  };
};
