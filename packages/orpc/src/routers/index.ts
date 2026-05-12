import { authRouter } from "./auth";
import { mailRouter } from "./mail";
import { mailDomainsRouter } from "./mail-domains";

export const appRouter = {
  auth: authRouter,
  mail: mailRouter,
  mailDomains: mailDomainsRouter,
};

export type AppRouter = typeof appRouter;
