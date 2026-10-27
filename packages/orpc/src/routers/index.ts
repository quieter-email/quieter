import { lazy } from "@orpc/server";

export const appRouter = {
  accountPreferences: lazy(
    async () =>
      await import("./account-preferences").then(
        ({ accountPreferencesRouter }) => ({
          default: accountPreferencesRouter,
        })
      )
  ),
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
  calendar: lazy(
    async () =>
      await import("./calendar").then(({ calendarRouter }) => ({
        default: calendarRouter,
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
  mailAgent: lazy(
    async () =>
      await import("./mail-agent").then(({ mailAgentRouter }) => ({
        default: mailAgentRouter,
      }))
  ),
  mailDomains: lazy(
    async () =>
      await import("./mail-domains").then(({ mailDomainsRouter }) => ({
        default: mailDomainsRouter,
      }))
  ),
  mailSnippets: lazy(
    async () =>
      await import("./mail-snippets").then(({ mailSnippetsRouter }) => ({
        default: mailSnippetsRouter,
      }))
  ),
  onboarding: lazy(
    async () =>
      await import("./onboarding").then(({ onboardingRouter }) => ({
        default: onboardingRouter,
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
