import { lazy } from "@orpc/server";

export const appRouter = {
  ai: lazy(
    async () =>
      await import("./ai").then(({ aiRouter }) => ({ default: aiRouter }))
  ),
  audiences: lazy(async () => {
    const { audiencesRouter } = await import("./audiences");
    return { default: audiencesRouter };
  }),
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
  campaigns: lazy(async () => {
    const { campaignsRouter } = await import("./campaigns");
    return { default: campaignsRouter };
  }),
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
  dailyBrief: lazy(
    async () =>
      await import("./daily-brief").then(({ dailyBriefRouter }) => ({
        default: dailyBriefRouter,
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
  organizationApiKeys: lazy(async () => {
    const { organizationApiKeysRouter } =
      await import("./organization-api-keys");
    return { default: organizationApiKeysRouter };
  }),
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
