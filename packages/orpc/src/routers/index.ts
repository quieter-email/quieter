import { authRouter } from "./auth";
import { billingRouter } from "./billing";
import { chatRouter } from "./chat";
import { mailRouter } from "./mail";
import { mailDomainsRouter } from "./mail-domains";
import { organizationMailUsageRouter } from "./organization-mail-usage";

export const appRouter = {
  auth: authRouter,
  billing: billingRouter,
  chat: chatRouter,
  mail: mailRouter,
  mailDomains: mailDomainsRouter,
  organizationMailUsage: organizationMailUsageRouter,
};

export type AppRouter = typeof appRouter;
