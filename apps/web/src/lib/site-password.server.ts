import { serverEnv } from "@quieter/env/server";
import { createHash, timingSafeEqual } from "node:crypto";

export const sitePasswordCookieName = "quieter_site_unlock";
export const sitePasswordMaxAgeSeconds = 60 * 60 * 24 * 400;

export const isSitePasswordGateEnabled = () => serverEnv.NODE_ENV !== "development";

const getSitePassword = () => serverEnv.APP_SITE_PASSWORD ?? "";

const getSigningSecret = () => serverEnv.BETTER_AUTH_SECRET || getSitePassword();

export const hasSitePasswordConfigured = () => getSitePassword().length > 0;

export const getSitePasswordToken = () => {
  const password = getSitePassword();
  const signingSecret = getSigningSecret();

  if (!password || !signingSecret) {
    return null;
  }

  return createHash("sha256").update(`${password}:${signingSecret}`).digest("base64url");
};

export const isCorrectSitePassword = (password: string) => {
  const expectedPassword = getSitePassword();

  if (!expectedPassword) {
    return false;
  }

  return timingSafeEqualString(password, expectedPassword);
};

export const isValidSitePasswordToken = (token: string | undefined) => {
  const expectedToken = getSitePasswordToken();

  if (!expectedToken || !token) {
    return false;
  }

  return timingSafeEqualString(token, expectedToken);
};

const timingSafeEqualString = (actual: string, expected: string) => {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
};
