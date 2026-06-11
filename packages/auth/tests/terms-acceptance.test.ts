import { describe, expect, test } from "bun:test";
import {
  readTermsAcceptedAtFromCookieHeader,
  termsAcceptanceCookieName,
} from "../src/terms-acceptance";

describe("terms acceptance cookie", () => {
  test("accepts a recent timestamp", () => {
    const acceptedAt = new Date(Date.now() - 60_000);
    const cookie = `${termsAcceptanceCookieName}=${encodeURIComponent(acceptedAt.toISOString())}`;

    expect(readTermsAcceptedAtFromCookieHeader(cookie)).toEqual(acceptedAt);
  });

  test("rejects stale, future, and invalid timestamps", () => {
    const stale = new Date(Date.now() - 11 * 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();

    expect(readTermsAcceptedAtFromCookieHeader(`${termsAcceptanceCookieName}=${stale}`)).toBeNull();
    expect(
      readTermsAcceptedAtFromCookieHeader(`${termsAcceptanceCookieName}=${future}`),
    ).toBeNull();
    expect(
      readTermsAcceptedAtFromCookieHeader(`${termsAcceptanceCookieName}=not-a-date`),
    ).toBeNull();
  });
});
