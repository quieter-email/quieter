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
const designSystem = createRoute({
  getParentRoute: () => app,
  path: "/design-system",
});
const privacy = createRoute({ getParentRoute: () => root, path: "/privacy" });
const terms = createRoute({ getParentRoute: () => root, path: "/terms" });
const cookies = createRoute({ getParentRoute: () => root, path: "/cookies" });
const imprint = createRoute({ getParentRoute: () => root, path: "/imprint" });

const audiences = createRoute({
  getParentRoute: () => app,
  path: "/audiences",
  validateSearch: zodValidator(
    z.object({ organizationId: z.string().optional() })
  ),
});
const audiencesIndex = createRoute({
  getParentRoute: () => audiences,
  path: "/",
});
const audiencesDetail = createRoute({
  getParentRoute: () => audiences,
  path: "/$audienceId",
});
const campaigns = createRoute({
  getParentRoute: () => app,
  path: "/campaigns",
  validateSearch: zodValidator(
    z.object({ organizationId: z.string().optional() })
  ),
});
const campaignsIndex = createRoute({
  getParentRoute: () => campaigns,
  path: "/",
});
const campaignsNew = createRoute({
  getParentRoute: () => campaigns,
  path: "/new",
});
const campaignsDetail = createRoute({
  getParentRoute: () => campaigns,
  path: "/$campaignId",
});
const campaignsContent = createRoute({
  getParentRoute: () => campaigns,
  path: "/$campaignId/content",
});
const campaignsAudience = createRoute({
  getParentRoute: () => campaigns,
  path: "/$campaignId/audience",
});
const campaignsReview = createRoute({
  getParentRoute: () => campaigns,
  path: "/$campaignId/review",
});
const templates = createRoute({
  getParentRoute: () => app,
  path: "/templates",
  validateSearch: zodValidator(
    z.object({ organizationId: z.string().optional() })
  ),
});
const templatesIndex = createRoute({
  getParentRoute: () => templates,
  path: "/",
});
const templatesNew = createRoute({
  getParentRoute: () => templates,
  path: "/new",
});
const templatesDetail = createRoute({
  getParentRoute: () => templates,
  path: "/$templateId",
});

export const router = createRouter({
  routeTree: root.addChildren([
    app.addChildren([
      inbox,
      settings,
      onboarding,
      auth,
      designSystem,
      audiences.addChildren([audiencesIndex, audiencesDetail]),
      campaigns.addChildren([
        campaignsIndex,
        campaignsNew,
        campaignsDetail,
        campaignsContent,
        campaignsAudience,
        campaignsReview,
      ]),
      templates.addChildren([templatesIndex, templatesNew, templatesDetail]),
    ]),
    home,
    privacy,
    terms,
    cookies,
    imprint,
  ]),
});
