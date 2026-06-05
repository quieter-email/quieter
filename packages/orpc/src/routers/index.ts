import { authRouter } from "./auth";
import { billingRouter } from "./billing";
import { chatRouter } from "./chat";
import { mailRouter } from "./mail";
import { mailDomainsRouter } from "./mail-domains";
import { teamMailUsageRouter } from "./team-mail-usage";

export const appRouter = {
  auth: authRouter,
  billing: billingRouter,
  chat: chatRouter,
  mail: mailRouter,
  mailDomains: mailDomainsRouter,
  teamMailUsage: teamMailUsageRouter,
};

export type AppRouter = typeof appRouter;
