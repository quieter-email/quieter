export const termsAcceptanceCookieName = "quieter_terms_accepted_at";

const parseCookieHeader = (cookieHeader: string | null) => {
  const cookies: Record<string, string> = {};

  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.split("=");
    const name = rawName?.trim();

    if (!name) {
      continue;
    }

    const rawCookieValue = rawValue.join("=").trim();

    try {
      cookies[name] = decodeURIComponent(rawCookieValue);
    } catch {
      cookies[name] = rawCookieValue;
    }
  }

  return cookies;
};

export const readTermsAcceptedAtFromCookieHeader = (cookieHeader: string | null) => {
  const rawValue = parseCookieHeader(cookieHeader)[termsAcceptanceCookieName];
  if (!rawValue) {
    return null;
  }

  const parsed = new Date(rawValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const readTermsAcceptedAtFromRequest = (request: Request | undefined) =>
  readTermsAcceptedAtFromCookieHeader(request?.headers.get("cookie") ?? null);
