import { db } from "@quieter/database/client";
import { waitlistSignup } from "@quieter/database/schema";

export const recordWaitlistSignup = async (email: string) => {
  const createdSignups = await db
    .insert(waitlistSignup)
    .values({
      createdAt: new Date(),
      email,
    })
    .onConflictDoNothing({
      target: waitlistSignup.email,
    })
    .returning({
      email: waitlistSignup.email,
    });

  return {
    email,
    status: createdSignups.length > 0 ? "created" : "existing",
  };
};
