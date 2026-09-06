import { eq } from "drizzle-orm";

import type { DatabaseClient } from "./client.ts";
import { organization } from "./schema.ts";

export const lockOrganizationUsage = async (
  transaction: Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0],
  organizationId: string
) => {
  const [owner] = await transaction
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .for("no key update");
  if (owner === undefined) {
    throw new Error("Usage has no owning organization.");
  }
};
