import type * as DatabaseClientModule from "@quieter/database/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  ConnectorHttpError,
  GOOGLE_CALENDAR_SCOPES,
  runAuthorizedConnector,
} from "../src/connectors/runtime";

const mocks = vi.hoisted(() => ({
  query:
    vi.fn<
      (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The proxy verifies token lookup ownership through generated SQL.
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return { ...actual, db: drizzle(mocks.query) };
});
vi.mock(import("../src/gmail-credential-crypto"), () => ({
  decryptGmailCredentialSecret: () => "cached-token",
  encryptGmailCredentialSecret: () => "encrypted-test",
}));
vi.mock(import("@quieter/env/server"), async (importOriginal) => ({
  ...(await importOriginal()),
  requireServerEnv: () => "test-credential",
}));

const input = {
  connectionId: "chosen-account",
  provider: "google_calendar" as const,
  userId: "owner-1",
};

describe("connection-scoped credential authorization", () => {
  beforeEach(() => mocks.query.mockReset().mockResolvedValue({ rows: [] }));
  afterEach(() => vi.unstubAllGlobals());

  test("never falls back to a different account when the requested connection is missing", async () => {
    const run = vi.fn<() => string>();
    await expect(runAuthorizedConnector(input, run)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(run).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledOnce();
    const [query, values] = mocks.query.mock.calls[0] ?? [];
    expect(query).toContain('"connectorCredential"."userId" =');
    expect(query).toContain('"connectorCredential"."id" =');
    expect(values).toContain(input.userId);
    expect(values).toContain(input.connectionId);
  });

  test("refreshes only the same selected account after an unauthorized provider response", async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [
          [
            new Date(Date.now() + 3_600_000),
            "encrypted-access",
            "encrypted-refresh",
            input.connectionId,
            input.provider,
            GOOGLE_CALENDAR_SCOPES.join(" "),
            "connected",
          ],
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          [
            "encrypted-refresh",
            input.connectionId,
            input.provider,
            GOOGLE_CALENDAR_SCOPES.join(" "),
          ],
        ],
      });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          access_token: "refreshed-token",
          expires_in: 3600,
          token_type: "Bearer",
        })
      )
    );
    const run = vi
      .fn<(token: string) => string>()
      .mockImplementationOnce(() => {
        throw new ConnectorHttpError("Unauthorized", 401);
      })
      .mockImplementation((token) => token);
    await expect(runAuthorizedConnector(input, run)).resolves.toBe(
      "refreshed-token"
    );
    const selects = mocks.query.mock.calls.filter(([query]) =>
      query.startsWith("select")
    );
    expect(selects).toHaveLength(2);
    for (const [query, values] of selects) {
      expect(query).toContain('"connectorCredential"."id" =');
      expect(values).toContain(input.connectionId);
      expect(values).toContain(input.userId);
    }
  });

  test("a calendar connection needing reconnection reports authorization loss", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        [
          new Date(Date.now() + 3_600_000),
          "encrypted-access",
          "encrypted-refresh",
          input.connectionId,
          input.provider,
          GOOGLE_CALENDAR_SCOPES.join(" "),
          "needs_reconnect",
        ],
      ],
    });
    const run = vi.fn<() => string>();
    await expect(runAuthorizedConnector(input, run)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
    expect(run).not.toHaveBeenCalled();
  });
});
