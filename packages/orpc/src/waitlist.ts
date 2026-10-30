import { db } from "@quieter/database/client";
import { waitlistSignup } from "@quieter/database/schema";

export const recordWaitlistSignup = async (email: string) => {
  await db
    .insert(waitlistSignup)
    .values({
      createdAt: new Date(),
      email,
    })
    .onConflictDoNothing({
      target: waitlistSignup.email,
    });

  return {
    email,
    status: "accepted",
  };
};
