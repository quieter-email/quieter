import type * as DatabaseClientModule from "@quieter/database/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { connectorProviderSchema } from "../src/connectors/contracts";
import {
  completeConnectorOAuth,
  listConnectors,
  startConnectorOAuth,
} from "../src/connectors/service";

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
    LINEAR_CLIENT_ID: "test-client",
    LINEAR_CLIENT_SECRET: "test-client-secret",
  };
  return {
    ...actual,
    requireServerEnv: (name: keyof typeof actual.serverEnv) =>
      name === "BETTER_AUTH_URL" ? configured.BETTER_AUTH_URL : "test-key",
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

  test("retires Calendar connector authorization without using legacy tokens", async () => {
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
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    await expect(
      completeConnectorOAuth({
        code: "code",
        headers: new Headers(),
        state: "opaque-state",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(request).not.toHaveBeenCalled();
    expect(
      mocks.query.mock.calls.some(([query]) =>
        query.includes('insert into "connectorCredential"')
      )
    ).toBeFalsy();
    expect(
      connectorProviderSchema.safeParse("google_calendar").success
    ).toBeFalsy();
  });

  test("lists only currently supported connectors", async () => {
    const result = await listConnectors("owner-1");
    expect(result.connectors).toMatchObject([
      expect.objectContaining({ provider: "linear" }),
    ]);
    const [query, params] = mocks.query.mock.calls[0] ?? [];
    expect(query).toContain('"connectorCredential"."userId" =');
    expect(query).toContain('"connectorCredential"."provider" =');
    expect(params).toContain("owner-1");
    expect(params).toContain("linear");
  });

  test.each([
    "//attacker.example/calendar",
    "/\\attacker.example/calendar",
    "/calendar\n/other",
    "https://attacker.example/calendar",
    "/safe/..//attacker.example/calendar",
  ])("rejects an escaping return URL %j", async (returnTo) => {
    await startConnectorOAuth({
      provider: "linear",
      returnTo,
      userId: "owner-1",
    });
    const insert = mocks.query.mock.calls.find(([query]) =>
      query.includes('insert into "connectorOAuthState"')
    );
    expect(insert?.[1]).toContain("/settings");
    expect(insert?.[1]).not.toContain(returnTo);
  });

  test("preserves safe return locations through the connection flow", async () => {
    await startConnectorOAuth({
      provider: "linear",
      returnTo: "/calendar?view=week#today",
      userId: "owner-1",
    });
    const insert = mocks.query.mock.calls.find(([query]) =>
      query.includes('insert into "connectorOAuthState"')
    );
    expect(insert?.[1]).toContain("/calendar?view=week#today");
  });

  test("keeps Linear account identity and sanitizes saved return URLs", async () => {
    const now = new Date();
    mocks.query.mockResolvedValueOnce({
      rows: [
        [
          "verifier",
          now,
          new Date(now.getTime() + 60_000),
          "opaque-state",
          "linear",
          "/\\attacker.example/calendar",
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
          refresh_token: "test-refresh",
          scope: "read,write",
          token_type: "Bearer",
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            organization: { id: "workspace", name: "Workspace" },
            viewer: {
              email: "second@example.com",
              id: "second-subject",
              name: "Second",
            },
          },
        })
      );
    vi.stubGlobal("fetch", request);
    await expect(
      completeConnectorOAuth({
        code: "code",
        headers: new Headers(),
        state: "opaque-state",
      })
    ).resolves.toMatchObject({ provider: "linear", returnTo: "/settings" });
    const insert = mocks.query.mock.calls.find(([query]) =>
      query.includes('insert into "connectorCredential"')
    );
    expect(insert?.[1]).toContain("workspace:second-subject");
    expect(insert?.[1]).toContain("second@example.com");
  });
});
