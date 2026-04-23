import { createFileRoute } from "@tanstack/react-router";
import {
  getSitePasswordToken,
  isCorrectSitePassword,
  sitePasswordCookieName,
  sitePasswordMaxAgeSeconds,
} from "~/lib/site-password.server";

export const Route = createFileRoute("/api/site-password")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const formData = await request.formData();
        const password = formData.get("password");
        const returnTo = getSafeReturnTo(formData.get("returnTo"), request.url);
        const token = getSitePasswordToken();

        if (typeof password !== "string" || !token || !isCorrectSitePassword(password)) {
          return redirectWithPasswordError(returnTo, request.url);
        }

        return new Response(null, {
          headers: {
            location: returnTo,
            "set-cookie": serializeSitePasswordCookie(token, request.url),
          },
          status: 302,
        });
      },
    },
  },
});

const getSafeReturnTo = (value: FormDataEntryValue | null, requestUrl: string) => {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  const url = new URL(value, requestUrl);

  return `${url.pathname}${url.search}${url.hash}`;
};

const redirectWithPasswordError = (returnTo: string, requestUrl: string) => {
  const url = new URL("/site-password", requestUrl);
  url.searchParams.set("returnTo", returnTo);
  url.searchParams.set("sitePasswordError", "1");

  return new Response(null, {
    headers: {
      location: `${url.pathname}${url.search}${url.hash}`,
    },
    status: 302,
  });
};

const serializeSitePasswordCookie = (token: string, requestUrl: string) => {
  const secureCookie = isSecureRequest(requestUrl) ? "; Secure" : "";

  return [
    `${sitePasswordCookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${sitePasswordMaxAgeSeconds}`,
    secureCookie,
  ]
    .filter(Boolean)
    .join("; ");
};

const isSecureRequest = (requestUrl: string) => new URL(requestUrl).protocol === "https:";
