import { lazy } from "@orpc/server";

export const appRouter = {
  ai: lazy(() => import("./ai").then(({ aiRouter }) => ({ default: aiRouter }))),
  auth: lazy(() => import("./auth").then(({ authRouter }) => ({ default: authRouter }))),
  billing: lazy(() =>
    import("./billing").then(({ billingRouter }) => ({ default: billingRouter })),
  ),
  chat: lazy(() => import("./chat").then(({ chatRouter }) => ({ default: chatRouter }))),
  connectors: lazy(() =>
    import("./connectors").then(({ connectorsRouter }) => ({ default: connectorsRouter })),
  ),
  mail: lazy(() => import("./mail").then(({ mailRouter }) => ({ default: mailRouter }))),
  mailDomains: lazy(() =>
    import("./mail-domains").then(({ mailDomainsRouter }) => ({ default: mailDomainsRouter })),
  ),
  mailboxActions: lazy(() =>
    import("./mailbox-actions").then(({ mailboxActionsRouter }) => ({
      default: mailboxActionsRouter,
    })),
  ),
  organization: lazy(() =>
    import("./organization").then(({ organizationRouter }) => ({ default: organizationRouter })),
  ),
  organizationMailUsage: lazy(() =>
    import("./organization-mail-usage").then(({ organizationMailUsageRouter }) => ({
      default: organizationMailUsageRouter,
    })),
  ),
};

export type AppRouter = typeof appRouter;
