import { db } from "@quieter/database/client";
import { platformAdmin } from "@quieter/database/schema";
import { eq } from "drizzle-orm";

export const hasPlatformOperationsAccess = async (userId: string) => {
  const [membership] = await db
    .select({ userId: platformAdmin.userId })
    .from(platformAdmin)
    .where(eq(platformAdmin.userId, userId))
    .limit(1);
  return membership !== undefined;
};
