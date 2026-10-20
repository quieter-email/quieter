import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import {
  mailboxSearchSchema,
  onboardingSearchSchema,
  settingsSearchSchema,
} from "../src/route-search";
import type { SessionUser } from "../src/session-user";

// Each host implements this route contract. This file is only used to check the package.
declare const loadUser: () => { user: SessionUser };
declare const loadSettings: () => {
  gmailError: { message: string; status: 400 | 401 | 403 | 409 } | null;
  user: SessionUser;
};

const root = createRootRoute();
const app = createRoute({ getParentRoute: () => root, id: "_app" });
const inbox = createRoute({
  getParentRoute: () => app,
  path: "/",
  validateSearch: zodValidator(mailboxSearchSchema),
  loader: loadUser,
});
const settings = createRoute({
  getParentRoute: () => app,
  path: "/settings",
  validateSearch: zodValidator(settingsSearchSchema),
  loader: loadSettings,
});
const onboarding = createRoute({
  getParentRoute: () => app,
  path: "/onboarding",
  validateSearch: zodValidator(onboardingSearchSchema),
  loader: loadUser,
});
const auth = createRoute({
  getParentRoute: () => app,
  path: "/auth",
  validateSearch: zodValidator(z.object({ returnTo: z.string().optional() })),
});
const home = createRoute({ getParentRoute: () => root, path: "/home" });
const privacy = createRoute({ getParentRoute: () => root, path: "/privacy" });
const terms = createRoute({ getParentRoute: () => root, path: "/terms" });
const cookies = createRoute({ getParentRoute: () => root, path: "/cookies" });
const imprint = createRoute({ getParentRoute: () => root, path: "/imprint" });

export const router = createRouter({
  routeTree: root.addChildren([
    app.addChildren([inbox, settings, onboarding, auth]),
    home,
    privacy,
    terms,
    cookies,
    imprint,
  ]),
});
