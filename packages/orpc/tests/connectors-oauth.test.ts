import type * as DatabaseClientModule from "@quieter/database/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { GOOGLE_CALENDAR_SCOPES } from "../src/connectors/runtime";
import { completeConnectorOAuth } from "../src/connectors/service";

const mocks = vi.hoisted(() => ({
  query:
    vi.fn<
      (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
  session: vi.fn<() => Promise<unknown>>(),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The proxy exercises the atomic owner and expiry predicates.
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return { ...actual, db: drizzle(mocks.query) };
});
// oxlint-disable-next-line vitest/prefer-import-in-mock -- OAuth callbacks only need authenticated identity.
vi.mock("@quieter/auth", () => ({
  auth: { api: { getSession: mocks.session } },
}));
vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const actual = await importOriginal();
  const configured = {
    BETTER_AUTH_URL: "http://127.0.0.1:3011",
    CONNECTOR_TOKEN_ENCRYPTION_KEY: "test-encryption-key",
    GOOGLE_CALENDAR_CLIENT_ID: "test-client",
    GOOGLE_CALENDAR_CLIENT_SECRET: "test-client-secret",
  };
  return {
    ...actual,
    requireServerEnv: (name: keyof typeof actual.serverEnv) =>
      name === "GOOGLE_CALENDAR_CLIENT_ID"
        ? configured.GOOGLE_CALENDAR_CLIENT_ID
        : configured.BETTER_AUTH_URL,
    serverEnv: { ...actual.serverEnv, ...configured },
  };
});
vi.mock(import("../src/gmail-credential-crypto"), () => ({
  decryptGmailCredentialSecret: () => "test-token",
  encryptGmailCredentialSecret: () => "encrypted-test-token",
}));

describe("connector OAuth state ownership", () => {
  beforeEach(() => {
    mocks.query.mockReset().mockResolvedValue({ rows: [] });
    mocks.session.mockReset().mockResolvedValue({
      session: { id: "session-1" },
      user: { id: "owner-1" },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  test("consumes state only for its signed-in owner while it is unexpired", async () => {
    await expect(
      completeConnectorOAuth({
        code: "code",
        headers: new Headers(),
        state: "opaque-state",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const [query, values] = mocks.query.mock.calls[0] ?? [];
    expect(query).toContain('delete from "connectorOAuthState"');
    expect(query).toContain('"connectorOAuthState"."userId" =');
    expect(query).toContain('"connectorOAuthState"."expiresAt" >');
    expect(values).toContain("opaque-state");
    expect(values).toContain("owner-1");
  });

  test("requires authentication before consuming any pending connection", async () => {
    mocks.session.mockResolvedValueOnce(null);
    await expect(
      completeConnectorOAuth({
        code: "code",
        headers: new Headers(),
        state: "opaque-state",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  test("adds a second account and searches previous credentials only by the returned subject", async () => {
    const now = new Date();
    mocks.query.mockResolvedValueOnce({
      rows: [
        [
          "verifier",
          now,
          new Date(now.getTime() + 60_000),
          "opaque-state",
          "google_calendar",
          "/calendar",
          "owner-1",
        ],
      ],
    });
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          access_token: "test-access",
          expires_in: 3600,
          id_token: "test-id-token",
          refresh_token: "test-refresh",
          scope: GOOGLE_CALENDAR_SCOPES.join(" "),
          token_type: "Bearer",
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          aud: "test-client",
          email: "second@example.com",
          email_verified: "true",
          exp: Math.floor(Date.now() / 1000) + 3600,
          iss: "accounts.google.com",
          sub: "second-subject",
        })
      );
    vi.stubGlobal("fetch", request);
    await expect(
      completeConnectorOAuth({
        code: "code",
        headers: new Headers(),
        state: "opaque-state",
      })
    ).resolves.toMatchObject({
      provider: "google_calendar",
      returnTo: "/calendar",
    });
    const credentialLookup = mocks.query.mock.calls.find(
      ([query]) =>
        query.includes("select") && query.includes('"connectorCredential"')
    );
    expect(credentialLookup?.[0]).toContain(
      '"connectorCredential"."providerAccountId" ='
    );
    expect(credentialLookup?.[1]).toContain("second-subject");
    const insert = mocks.query.mock.calls.find(([query]) =>
      query.includes('insert into "connectorCredential"')
    );
    expect(insert?.[1]).toContain("second-subject");
    expect(insert?.[1]).toContain("second@example.com");
  });

  test("does not reuse another account's refresh token if a newly selected account has no offline grant", async () => {
    const now = new Date();
    mocks.query.mockResolvedValueOnce({
      rows: [
        [
          "verifier",
          now,
          new Date(now.getTime() + 60_000),
          "opaque-state",
          "google_calendar",
          "/calendar",
          "owner-1",
        ],
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({
            access_token: "test-access",
            expires_in: 3600,
            id_token: "test-id-token",
            scope: GOOGLE_CALENDAR_SCOPES.join(" "),
            token_type: "Bearer",
          })
        )
        .mockResolvedValueOnce(
          Response.json({
            aud: "test-client",
            email: "second@example.com",
            email_verified: "true",
            exp: Math.floor(Date.now() / 1000) + 3600,
            iss: "accounts.google.com",
            sub: "second-subject",
          })
        )
    );
    await expect(
      completeConnectorOAuth({
        code: "code",
        headers: new Headers(),
        state: "opaque-state",
      })
    ).rejects.toThrow("offline refresh token");
    expect(
      mocks.query.mock.calls.some(([query]) =>
        query.includes('insert into "connectorCredential"')
      )
    ).toBeFalsy();
  });
});
