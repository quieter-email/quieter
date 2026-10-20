import { AppProviders } from "@quieter/app/components/app-providers";
import { LoadingPage } from "@quieter/app/components/loading-page";
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
