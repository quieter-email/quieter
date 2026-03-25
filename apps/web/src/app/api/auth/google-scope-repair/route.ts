import { auth, getSessionWithOrganization } from "@quietr/auth";
import { REQUIRED_GOOGLE_SCOPES } from "@quietr/auth/google-scopes";
import { getGoogleScopeRepairTarget } from "@quietr/orpc/mailbox-service";
import { NextResponse } from "next/server";
import {
  getGoogleScopeRepairPageHref,
  getGoogleScopeRepairReturnTo,
} from "~/lib/google-scope-repair";

export const runtime = "nodejs";

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

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const targetAccountId = requestUrl.searchParams.get("targetAccountId")?.trim() || null;
  const returnTo = getGoogleScopeRepairReturnTo(requestUrl.searchParams.get("from"));
  const authHeaders = new Headers(request.headers);
  const session = await getSessionWithOrganization(authHeaders);

  if (!session?.user || !session.session?.activeOrganizationId) {
    return NextResponse.redirect(new URL("/home", requestUrl));
  }

  const repairTarget = await getGoogleScopeRepairTarget({
    activeOrganizationId: session.session.activeOrganizationId,
    headers: authHeaders,
    targetAccountId,
    userId: session.user.id,
  });

  if (!repairTarget) {
    return NextResponse.redirect(new URL(returnTo, requestUrl));
  }

  if (targetAccountId !== repairTarget.providerAccountId) {
    return NextResponse.redirect(
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
    return NextResponse.redirect(new URL(callbackURL, requestUrl));
  }

  const providerUrl = new URL(repairResponse.response.url);
  providerUrl.searchParams.set("login_hint", repairTarget.emailAddress);
  providerUrl.searchParams.set("prompt", "consent select_account");

  const redirectResponse = NextResponse.redirect(providerUrl);

  if (repairResponse.headers) {
    appendSetCookieHeaders(redirectResponse.headers, repairResponse.headers);
  }

  return redirectResponse;
}
