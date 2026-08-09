import { lazy } from "@orpc/server";

export const appRouter = {
  ai: lazy(
    async () =>
      await import("./ai").then(({ aiRouter }) => ({ default: aiRouter }))
  ),
  auth: lazy(
    async () =>
      await import("./auth").then(({ authRouter }) => ({ default: authRouter }))
  ),
  billing: lazy(
    async () =>
      await import("./billing").then(({ billingRouter }) => ({
        default: billingRouter,
      }))
  ),
  chat: lazy(
    async () =>
      await import("./chat").then(({ chatRouter }) => ({ default: chatRouter }))
  ),
  connectors: lazy(
    async () =>
      await import("./connectors").then(({ connectorsRouter }) => ({
        default: connectorsRouter,
      }))
  ),
  mail: lazy(
    async () =>
      await import("./mail").then(({ mailRouter }) => ({ default: mailRouter }))
  ),
  mailDomains: lazy(
    async () =>
      await import("./mail-domains").then(({ mailDomainsRouter }) => ({
        default: mailDomainsRouter,
      }))
  ),
  mailTemplates: lazy(
    async () =>
      await import("./mail-templates").then(({ mailTemplatesRouter }) => ({
        default: mailTemplatesRouter,
      }))
  ),
  mailboxActions: lazy(
    async () =>
      await import("./mailbox-actions").then(({ mailboxActionsRouter }) => ({
        default: mailboxActionsRouter,
      }))
  ),
  organization: lazy(
    async () =>
      await import("./organization").then(({ organizationRouter }) => ({
        default: organizationRouter,
      }))
  ),
  organizationMailUsage: lazy(
    async () =>
      await import("./organization-mail-usage").then(
        ({ organizationMailUsageRouter }) => ({
          default: organizationMailUsageRouter,
        })
      )
  ),
};

export type AppRouter = typeof appRouter;
