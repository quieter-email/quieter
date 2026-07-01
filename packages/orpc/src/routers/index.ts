import { authRouter } from "./auth";
import { billingRouter } from "./billing";
import { chatRouter } from "./chat";
import { connectorsRouter } from "./connectors";
import { mailRouter } from "./mail";
import { mailDomainsRouter } from "./mail-domains";
import { organizationRouter } from "./organization";
import { organizationMailUsageRouter } from "./organization-mail-usage";

export const appRouter = {
  auth: authRouter,
  billing: billingRouter,
  chat: chatRouter,
  connectors: connectorsRouter,
  mail: mailRouter,
  mailDomains: mailDomainsRouter,
  organization: organizationRouter,
  organizationMailUsage: organizationMailUsageRouter,
};

export type AppRouter = typeof appRouter;
