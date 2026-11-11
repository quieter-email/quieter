import { db } from "@quieter/database/client";
import type { DatabaseClient } from "@quieter/database/client";
import {
  user,
  waitlistSettingRevision,
  waitlistSignup,
} from "@quieter/database/schema";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

const defaultWaitlistOpen = true;
const waitlistIntakeSchema = z.object({ waitlistOpen: z.boolean() });

export const getWaitlistSettings = async (database: DatabaseClient) => {
  const history = await database
    .select({
      actorName: user.name,
      changedAt: waitlistSettingRevision.changedAt,
      id: waitlistSettingRevision.id,
      waitlistOpen: waitlistSettingRevision.waitlistOpen,
    })
    .from(waitlistSettingRevision)
    .leftJoin(user, eq(waitlistSettingRevision.actorUserId, user.id))
    .orderBy(desc(waitlistSettingRevision.id))
    .limit(20);
  return {
    history,
    waitlistOpen: history[0]?.waitlistOpen ?? defaultWaitlistOpen,
  };
};

export const recordWaitlistSignup = async (
  email: string
): Promise<{ status: "closed" } | { email: string; status: "accepted" }> => {
  const latestRevision = db
    .select({ waitlistOpen: waitlistSettingRevision.waitlistOpen })
    .from(waitlistSettingRevision)
    .orderBy(desc(waitlistSettingRevision.id))
    .limit(1);
  // The pause check and signup share a snapshot.
  const [intake] = await db.execute(sql`with intake as (
    select coalesce((${latestRevision}), ${defaultWaitlistOpen}) as "waitlistOpen"
  ), signup as (
    insert into ${waitlistSignup} ("createdAt", "email")
    select ${new Date().toISOString()}::timestamp, ${email}
    from intake where "waitlistOpen"
    on conflict ("email") do nothing
  )
  select "waitlistOpen" from intake`);

  const { waitlistOpen } = waitlistIntakeSchema.parse(intake);
  return waitlistOpen ? { email, status: "accepted" } : { status: "closed" };
};
