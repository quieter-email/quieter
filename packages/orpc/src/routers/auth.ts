import { getAuthUserStatus } from "@quieter/auth/user-status";
import { z } from "zod";

import { publicProcedure } from "./base";

export const authRouter = {
  getUserStatus: publicProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        email: z.email(),
      })
    )
    .handler(async ({ input }) => await getAuthUserStatus(input.email)),
};
