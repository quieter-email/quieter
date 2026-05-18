import { getAuthUserStatus } from "@quieter/auth/user-status";
import { z } from "zod";
import { publicProcedure } from "./base";

export const authRouter = {
  getUserStatus: publicProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        email: z.string().trim().email(),
      }),
    )
    .handler(async ({ input }) => {
      return await getAuthUserStatus(input.email);
    }),
};
