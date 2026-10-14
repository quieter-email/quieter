import { db } from "@quieter/database/client";
import { organization } from "@quieter/database/schema";
import { sql } from "drizzle-orm";

export const checkDeploymentDatabase = async () => {
  await db.transaction(
    async (transaction) => {
      await transaction.execute(sql`set local statement_timeout = '2s'`);
      await transaction
        .select({ id: organization.id })
        .from(organization)
        .limit(1);
    },
    { accessMode: "read only" }
  );
};
