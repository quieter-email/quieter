import { auth } from "@quietr/auth";
import { REQUIRED_GOOGLE_SCOPES } from "@quietr/auth/google-scopes";
import { redirect } from "@solidjs/router";
import { createMiddleware } from "@solidjs/start/middleware";

const API_PREFIX = "/api/";

export default createMiddleware({
  onRequest: async (event) => {
    const { pathname } = new URL(event.request.url);

    // Never gate API routes — they handle auth themselves.
    if (pathname.startsWith(API_PREFIX)) return;

    const session = await auth.api.getSession({ headers: event.request.headers });

    // Auth page: redirect already-authenticated users to inbox.
    if (pathname === "/auth") {
      if (session?.user) return redirect("/");
      return;
    }

    // Public landing page — no auth required.
    if (pathname === "/home") return;

    // All other routes require authentication.
    if (!session?.user) return redirect("/home");

    // Check Google scopes — missing scopes trigger the OAuth re-link flow.
    const accounts = await auth.api.listUserAccounts({
      headers: event.request.headers,
    });

    const googleAccount = accounts.find((account) => account.providerId === "google");

    const scopeValue = googleAccount?.scopes ?? [];
    const grantedScopes = new Set(
      (Array.isArray(scopeValue) ? scopeValue : String(scopeValue).split(/[\s,]+/)).filter(Boolean),
    );

    const hasAllScopes = REQUIRED_GOOGLE_SCOPES.every((scope) => grantedScopes.has(scope));

    if (!hasAllScopes) {
      const relinkResponse = await auth.api.linkSocialAccount({
        body: {
          callbackURL: pathname,
          provider: "google",
          scopes: [...REQUIRED_GOOGLE_SCOPES],
          disableRedirect: true,
        },
        headers: event.request.headers,
      });

      const url =
        typeof relinkResponse === "object" && relinkResponse !== null
          ? (((relinkResponse as Record<string, unknown>).url as string | undefined) ??
            ((
              (relinkResponse as Record<string, unknown>).data as
                | Record<string, unknown>
                | undefined
            )?.url as string | undefined))
          : undefined;

      if (url) return redirect(url);
    }
  },
});
