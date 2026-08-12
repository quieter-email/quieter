import { z } from "zod";

import { completeOnboarding, getOnboardingState } from "../onboarding/service";
import { protectedProcedure } from "./base";

export const onboardingRouter = {
  complete: protectedProcedure
    .input(
      z.object({
        acceptedTerms: z.literal(true),
        name: z.string().trim().min(1).max(120),
        teamName: z.string().trim().max(120).optional(),
      })
    )
    .handler(async ({ context, input }) => {
      await completeOnboarding({
        name: input.name,
        teamName: input.teamName,
        userId: context.userId,
      });

      return { completed: true };
    }),
  getState: protectedProcedure
    .route({ method: "GET" })
    .handler(async ({ context }) => await getOnboardingState(context.userId)),
};
