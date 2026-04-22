import { auth, getSessionWithOrganization } from "@quieter/auth";
import { REQUIRED_GOOGLE_SCOPES } from "@quieter/auth/google-scopes";
import { createOrpcServerClient } from "@quieter/orpc/server-client";
import { createFileRoute } from "@tanstack/react-router";
import {
  getGoogleScopeRepairPageHref,
  getGoogleScopeRepairReturnTo,
} from "~/lib/google-scope-repair";

const appendSetCookieHeaders = (target: Headers, source: Headers) => {
  const setCookieValues =
    typeof source.getSetCookie === "function"
      ? source.getSetCookie()
      : (source
          .get("set-cookie")
          ?.split(/,(?=[^;]+=[^;]+)/g)
          .map((value) => value.trim())
          .filter(Boolean) ?? []);

  for (const setCookieValue of setCookieValues) {
    target.append("set-cookie", setCookieValue);
  }
};

const redirectResponse = (location: string | URL, headers?: HeadersInit) => {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("location", location.toString());

  return new Response(null, {
    headers: responseHeaders,
    status: 302,
  });
};

export const Route = createFileRoute("/api/auth/google-scope-repair")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const targetAccountId = requestUrl.searchParams.get("targetAccountId")?.trim() || null;
        const returnTo = getGoogleScopeRepairReturnTo(requestUrl.searchParams.get("from"));
        const authHeaders = new Headers(request.headers);
        const session = await getSessionWithOrganization(authHeaders);

        if (!session?.user || !session.session?.activeOrganizationId) {
          return redirectResponse(new URL("/home", requestUrl));
        }

        const client = createOrpcServerClient({
          headers: authHeaders,
        });
        const repairTarget = await client.mail.getGoogleScopeRepairTarget({
          preferredMailboxId: null,
          targetAccountId,
        });

        if (!repairTarget) {
          return redirectResponse(new URL(returnTo, requestUrl));
        }

        if (targetAccountId !== repairTarget.providerAccountId) {
          return redirectResponse(
            new URL(
              getGoogleScopeRepairPageHref({
                from: returnTo,
                targetAccountId: repairTarget.providerAccountId,
              }),
              requestUrl,
            ),
          );
        }

        const callbackURL = getGoogleScopeRepairPageHref({
          from: returnTo,
          returned: true,
          targetAccountId: repairTarget.providerAccountId,
        });
        const repairResponse = await auth.api.linkSocialAccount({
          body: {
            callbackURL,
            disableRedirect: true,
            errorCallbackURL: callbackURL,
            provider: "google",
            scopes: [...REQUIRED_GOOGLE_SCOPES],
          },
          headers: authHeaders,
          returnHeaders: true,
        });

        if (!repairResponse.response?.url) {
          return redirectResponse(new URL(callbackURL, requestUrl));
        }

        const providerUrl = new URL(repairResponse.response.url);
        providerUrl.searchParams.set("login_hint", repairTarget.emailAddress);
        providerUrl.searchParams.set("prompt", "consent select_account");

        const response = redirectResponse(providerUrl);

        if (repairResponse.headers) {
          appendSetCookieHeaders(response.headers, repairResponse.headers);
        }

        return response;
      },
    },
  },
});
