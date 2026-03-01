import { REQUIRED_GOOGLE_SCOPES } from "@quietr/auth/google-scopes";
import { createAuthClient } from "better-auth/solid";
import { getRequestEvent } from "solid-js/web";

export { REQUIRED_GOOGLE_SCOPES };

export const authClient = createAuthClient({});

export const { signIn, signUp, signOut, useSession, linkSocial } = authClient;

const getServerRequestHeaders = () => {
  return getRequestEvent()?.request.headers ?? {};
};

const normalizeScopes = (scopeValue: unknown): string[] => {
  if (Array.isArray(scopeValue)) {
    return scopeValue
      .filter((scope): scope is string => typeof scope === "string")
      .map((scope) => scope.trim())
      .filter(Boolean);
  }

  if (typeof scopeValue === "string") {
    return scopeValue
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
  }

  return [];
};

type SocialAccount = {
  provider?: string;
  providerId?: string;
  scope?: string | string[] | null;
  scopes?: string | string[] | null;
};

const normalizeAccounts = (response: unknown): SocialAccount[] => {
  if (Array.isArray(response)) return response as SocialAccount[];

  if (typeof response === "object" && response !== null && "data" in response) {
    const data = (response as { data?: unknown }).data;
    if (Array.isArray(data)) return data as SocialAccount[];
  }

  return [];
};

const getAccountScopes = (account?: SocialAccount) =>
  normalizeScopes(account?.scopes ?? account?.scope);

export const getGoogleScopeStatus = async () => {
  const response = import.meta.env.SSR
    ? await (
        await import("@quietr/auth")
      ).auth.api.listUserAccounts({
        headers: getServerRequestHeaders(),
      })
    : await authClient.listAccounts();
  const accounts = normalizeAccounts(response);

  const googleAccount = accounts.find(
    (account) => account.provider === "google" || account.providerId === "google",
  );

  const grantedScopes = new Set(getAccountScopes(googleAccount));
  const missingScopes = REQUIRED_GOOGLE_SCOPES.filter((scope) => !grantedScopes.has(scope));

  return {
    hasRequiredScopes: missingScopes.length === 0,
    missingScopes,
  };
};

const extractOAuthUrl = (response: unknown): string | null => {
  if (typeof response !== "object" || response === null) return null;

  if ("data" in response) {
    const data = (response as { data?: unknown }).data;
    if (typeof data === "object" && data !== null && "url" in data) {
      const url = (data as { url?: unknown }).url;
      if (typeof url === "string") return url;
    }
  }

  if ("url" in response) {
    const url = (response as { url?: unknown }).url;
    if (typeof url === "string") return url;
  }

  return null;
};

export const getGoogleRelinkUrl = async (callbackURL = "/") => {
  if (import.meta.env.SSR) {
    const response = await (
      await import("@quietr/auth")
    ).auth.api.linkSocialAccount({
      body: {
        callbackURL,
        provider: "google",
        scopes: [...REQUIRED_GOOGLE_SCOPES],
        disableRedirect: true,
      },
      headers: getServerRequestHeaders(),
    });
    return extractOAuthUrl(response);
  }

  const response = await authClient.linkSocial({
    callbackURL,
    provider: "google",
    scopes: [...REQUIRED_GOOGLE_SCOPES],
    disableRedirect: true,
  });
  return extractOAuthUrl(response);
};

export const getSession = async () => {
  if (import.meta.env.SSR) {
    return await (
      await import("@quietr/auth")
    ).auth.api.getSession({
      headers: getServerRequestHeaders(),
    });
  }

  return (await authClient.getSession()).data;
};

export const getAccessToken = async (providerId: string) => {
  if (import.meta.env.SSR) {
    const res = await (
      await import("@quietr/auth")
    ).auth.api.getAccessToken({
      body: { providerId },
      headers: getServerRequestHeaders(),
    });
    return res?.accessToken ?? null;
  }

  const res = await authClient.getAccessToken({ providerId });
  return res?.data?.accessToken ?? null;
};
