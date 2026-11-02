import { AppProviders } from "@quieter/app/components/app-providers";
import { LoadingPage } from "@quieter/app/components/loading-page";
import { AudienceDetail } from "@quieter/app/features/broadcasts/components/audience-detail";
import { AudiencesList } from "@quieter/app/features/broadcasts/components/audiences-list";
import { BroadcastWorkspace } from "@quieter/app/features/broadcasts/components/broadcast-workspace";
import { CampaignDetail } from "@quieter/app/features/broadcasts/components/campaign-detail";
import {
  CampaignPage,
  CampaignCreate,
} from "@quieter/app/features/broadcasts/components/campaign-editor";
import { CampaignsList } from "@quieter/app/features/broadcasts/components/campaigns-list";
import {
  TemplateEditor,
  TemplateDetail,
  TemplatesList,
} from "@quieter/app/features/broadcasts/components/templates";
import {
  mailboxSearchSchema,
  onboardingSearchSchema,
  settingsSearchSchema,
} from "@quieter/app/route-search";
import type { SessionUser } from "@quieter/app/session-user";
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { DesktopAuthScreen } from "./auth-screen";
import { DesktopErrorScreen, DesktopNotFoundScreen } from "./error-screen";

const userSchema = z.object({
  email: z.string(),
  emailVerified: z.boolean(),
  id: z.string(),
  image: z.string().nullable(),
  name: z.string(),
  needsOnboarding: z.boolean(),
});

const loadUser = async (): Promise<SessionUser | null> => {
  const response = await fetch(
    `${window.quieterDesktop.apiBaseURL}/api/desktop/session`
  );
  if (!response.ok) {
    throw new Error("Unable to reach your account. Please try again.");
  }
  const data: unknown = await response.json();
  return userSchema.nullable().parse(data);
};

const rootRoute = createRootRoute({
  component: Outlet,
  errorComponent: DesktopErrorScreen,
  notFoundComponent: DesktopNotFoundScreen,
});

const appRoute = createRoute({
  component: () => (
    <AppProviders>
      <Outlet />
    </AppProviders>
  ),
  getParentRoute: () => rootRoute,
  id: "_app",
});

const authRoute = createRoute({
  validateSearch: zodValidator(z.object({ returnTo: z.string().optional() })),
  component: DesktopAuthScreen,
  getParentRoute: () => appRoute,
  loader: async () => {
    const user = await loadUser();
    if (user) {
      throw redirect({ to: user.needsOnboarding ? "/onboarding" : "/" });
    }
  },
  path: "/auth",
});

const inboxRoute = createRoute({
  validateSearch: zodValidator(mailboxSearchSchema),
  component: lazyRouteComponent(
    async () => await import("./inbox-route"),
    "DesktopInboxRoute"
  ),
  getParentRoute: () => appRoute,
  loader: async ({ location }) => {
    const user = await loadUser();
    if (!user) {
      throw redirect({ search: { returnTo: location.href }, to: "/auth" });
    }
    if (user.needsOnboarding) {
      throw redirect({
        search: { returnTo: location.href },
        to: "/onboarding",
      });
    }
    return { user };
  },
  path: "/",
  pendingComponent: LoadingPage,
});

const settingsRoute = createRoute({
  validateSearch: zodValidator(settingsSearchSchema),
  component: lazyRouteComponent(
    async () =>
      await import("@quieter/app/features/settings/components/settings-route-component"),
    "SettingsRouteComponent"
  ),
  getParentRoute: () => appRoute,
  loader: async () => {
    const user = await loadUser();
    if (!user) {
      throw redirect({ to: "/auth" });
    }
    if (user.needsOnboarding) {
      throw redirect({ search: { returnTo: "/settings" }, to: "/onboarding" });
    }
    return { gmailError: null, user };
  },
  path: "/settings",
  pendingComponent: LoadingPage,
});

const onboardingRoute = createRoute({
  validateSearch: zodValidator(onboardingSearchSchema),
  component: lazyRouteComponent(
    async () =>
      await import("@quieter/app/features/onboarding/components/onboarding-screen"),
    "OnboardingScreen"
  ),
  getParentRoute: () => appRoute,
  loader: async () => {
    const user = await loadUser();
    if (!user) {
      throw redirect({ to: "/auth" });
    }
    if (!user.needsOnboarding) {
      throw redirect({ to: "/" });
    }
    return { user };
  },
  path: "/onboarding",
  pendingComponent: LoadingPage,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  loader: () => {
    throw redirect({ to: "/auth" });
  },
  path: "/home",
});

const designSystemRoute = createRoute({
  component: lazyRouteComponent(
    async () =>
      await import("@quieter/app/features/design-system/components/design-system-showcase"),
    "DesignSystemShowcase"
  ),
  getParentRoute: () => appRoute,
  path: "/design-system",
});

const loadBroadcastUser = async () => {
  const user = await loadUser();
  if (!user) {
    throw redirect({ to: "/auth" });
  }
  if (user.needsOnboarding) {
    throw redirect({ to: "/onboarding" });
  }
  return { user };
};

const audiencesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/audiences",
  validateSearch: zodValidator(
    z.object({ organizationId: z.string().optional() })
  ),
  loader: loadBroadcastUser,
  pendingComponent: LoadingPage,
  component: () => (
    <BroadcastWorkspace
      organizationId={audiencesRoute.useSearch().organizationId}
      section="audiences"
    >
      <Outlet />
    </BroadcastWorkspace>
  ),
});
const audiencesIndexRoute = createRoute({
  getParentRoute: () => audiencesRoute,
  path: "/",
  component: AudiencesList,
});
const audienceRoute = createRoute({
  getParentRoute: () => audiencesRoute,
  path: "/$audienceId",
  component: () => {
    const { audienceId } = audienceRoute.useParams();
    return <AudienceDetail audienceId={audienceId} key={audienceId} />;
  },
});
const campaignsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/campaigns",
  validateSearch: zodValidator(
    z.object({ organizationId: z.string().optional() })
  ),
  loader: loadBroadcastUser,
  pendingComponent: LoadingPage,
  component: () => (
    <BroadcastWorkspace
      organizationId={campaignsRoute.useSearch().organizationId}
      section="campaigns"
    >
      <Outlet />
    </BroadcastWorkspace>
  ),
});
const campaignsIndexRoute = createRoute({
  getParentRoute: () => campaignsRoute,
  path: "/",
  component: CampaignsList,
});
const campaignNewRoute = createRoute({
  getParentRoute: () => campaignsRoute,
  path: "/new",
  component: CampaignCreate,
});
const campaignRoute = createRoute({
  getParentRoute: () => campaignsRoute,
  path: "/$campaignId",
  component: Outlet,
});
const campaignDetailRoute = createRoute({
  getParentRoute: () => campaignRoute,
  path: "/",
  component: () => {
    const { campaignId } = campaignDetailRoute.useParams();
    return <CampaignDetail campaignId={campaignId} key={campaignId} />;
  },
});
const campaignContentRoute = createRoute({
  getParentRoute: () => campaignRoute,
  path: "/content",
  component: () => (
    <CampaignPage
      campaignId={campaignContentRoute.useParams().campaignId}
      step="content"
    />
  ),
});
const campaignAudienceRoute = createRoute({
  getParentRoute: () => campaignRoute,
  path: "/audience",
  component: () => (
    <CampaignPage
      campaignId={campaignAudienceRoute.useParams().campaignId}
      step="audience"
    />
  ),
});
const campaignReviewRoute = createRoute({
  getParentRoute: () => campaignRoute,
  path: "/review",
  component: () => (
    <CampaignPage
      campaignId={campaignReviewRoute.useParams().campaignId}
      step="review"
    />
  ),
});
const templatesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/templates",
  validateSearch: zodValidator(
    z.object({ organizationId: z.string().optional() })
  ),
  loader: loadBroadcastUser,
  pendingComponent: LoadingPage,
  component: () => (
    <BroadcastWorkspace
      organizationId={templatesRoute.useSearch().organizationId}
      section="templates"
    >
      <Outlet />
    </BroadcastWorkspace>
  ),
});
const templatesIndexRoute = createRoute({
  getParentRoute: () => templatesRoute,
  path: "/",
  component: TemplatesList,
});
const templateNewRoute = createRoute({
  getParentRoute: () => templatesRoute,
  path: "/new",
  component: TemplateEditor,
});
const templateRoute = createRoute({
  getParentRoute: () => templatesRoute,
  path: "/$templateId",
  component: () => {
    const { templateId } = templateRoute.useParams();
    return <TemplateDetail key={templateId} templateId={templateId} />;
  },
});

const legalRoutes = (
  ["/privacy", "/cookies", "/terms", "/imprint"] as const
).map((path) =>
  createRoute({
    getParentRoute: () => rootRoute,
    loader: async () => {
      await window.quieterDesktop.openExternal(path);
      throw redirect({ to: "/" });
    },
    path,
  })
);

export const router = createRouter({
  defaultPendingMinMs: 0,
  routeTree: rootRoute.addChildren([
    appRoute.addChildren([
      authRoute,
      inboxRoute,
      settingsRoute,
      onboardingRoute,
      designSystemRoute,
      audiencesRoute.addChildren([audiencesIndexRoute, audienceRoute]),
      campaignsRoute.addChildren([
        campaignsIndexRoute,
        campaignNewRoute,
        campaignRoute.addChildren([
          campaignDetailRoute,
          campaignContentRoute,
          campaignAudienceRoute,
          campaignReviewRoute,
        ]),
      ]),
      templatesRoute.addChildren([
        templatesIndexRoute,
        templateNewRoute,
        templateRoute,
      ]),
    ]),
    homeRoute,
    ...legalRoutes,
  ]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
