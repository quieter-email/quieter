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
  getCalendarAccountForUser,
  listCalendarAccountsForUser,
  listCalendarsForUser,
} from "../src/calendar/service";
import { CALENDAR_SCOPES } from "../src/gmail-mailbox-access";

const mocks = vi.hoisted(() => ({
  decrypt: vi.fn<(encrypted: string) => string>(),
  legacyRows: [] as unknown[][],
  mailboxRows: [] as unknown[][],
  query:
    vi.fn<
      (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
  scopes: "",
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The proxy verifies ownership predicates in the actual generated SQL.
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return { ...actual, db: drizzle(mocks.query) };
});
vi.mock(import("../src/gmail-credential-crypto"), () => ({
  decryptGmailCredentialSecret: mocks.decrypt,
  encryptGmailCredentialSecret: () => "encrypted-test",
}));
vi.mock(import("@quieter/env/server"), async (importOriginal) => ({
  ...(await importOriginal()),
  requireServerEnv: () => "test-credential",
}));

const input = { connectionId: "legacy-account", userId: "owner-1" };

describe("Gmail calendar account authorization", () => {
  beforeEach(() => {
    mocks.decrypt.mockReset().mockImplementation((encrypted) => encrypted);
    mocks.scopes = CALENDAR_SCOPES.join(" ");
    mocks.mailboxRows = [
      [
        "Work",
        "current@example.test",
        "same-google-subject",
        "mailbox-1",
        mocks.scopes,
        "connected",
      ],
    ];
    mocks.legacyRows = [
      [
        "old@example.test",
        "Old calendar name",
        input.connectionId,
        "same-google-subject",
      ],
    ];
    mocks.query.mockReset().mockImplementation(async (query, params) => {
      if (query.startsWith("update")) {
        return await Promise.resolve({ rows: [["mailbox-1"]] });
      }
      if (!params.includes(input.userId)) {
        return await Promise.resolve({ rows: [] });
      }
      if (query.includes('"accessTokenExpiresAt"')) {
        return await Promise.resolve({
          rows: [
            [
              new Date("2099-01-01T00:00:00Z"),
              "current@example.test",
              "gmail-access",
              "gmail-refresh",
              "mailbox-1",
              mocks.scopes,
              "connected",
            ],
          ],
        });
      }
      return await Promise.resolve({
        rows: query.includes('from "connectorCredential"')
          ? mocks.legacyRows
          : mocks.mailboxRows,
      });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  test("uses an owned subject match to preserve old IDs even when the account email changed", async () => {
    const result = await listCalendarAccountsForUser(input);
    expect(result.accounts).toMatchObject([
      {
        email: "current@example.test",
        id: input.connectionId,
        mailboxId: "mailbox-1",
        status: "connected",
      },
    ]);
    expect(result.accounts).toHaveLength(1);
    await expect(
      getCalendarAccountForUser({ ...input, connectionId: "mailbox-1" })
    ).resolves.toMatchObject({ id: "mailbox-1", mailboxId: "mailbox-1" });
    expect(mocks.decrypt).not.toHaveBeenCalled();
    for (const [query, params] of mocks.query.mock.calls) {
      expect(params).toContain(input.userId);
      expect(query).not.toContain('"encryptedAccessToken"');
      expect(query).not.toContain('"encryptedRefreshToken"');
    }
  });

  test("never matches a legacy account to a Gmail mailbox by email alone", async () => {
    mocks.legacyRows = [
      [
        "current@example.test",
        null,
        input.connectionId,
        "different-google-subject",
      ],
    ];
    const result = await listCalendarAccountsForUser(input);
    expect(result.accounts).toMatchObject([
      { id: "mailbox-1", mailboxId: "mailbox-1", status: "connected" },
      { id: input.connectionId, mailboxId: null, status: "needs-mailbox" },
    ]);
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    await expect(listCalendarsForUser(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(request).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  test.each(["mailbox-1", input.connectionId])(
    "denies another owner or shared-mailbox grantee access through %s",
    async (connectionId) => {
      const request = vi.fn<typeof fetch>();
      vi.stubGlobal("fetch", request);
      await expect(
        listCalendarsForUser({ connectionId, userId: "other-user" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(request).not.toHaveBeenCalled();
      expect(mocks.decrypt).not.toHaveBeenCalled();
      for (const [query, params] of mocks.query.mock.calls) {
        expect(query).toContain(
          query.includes('from "connectorCredential"')
            ? '"connectorCredential"."userId" ='
            : '"mailbox"."ownerUserId" ='
        );
        expect(params).toContain("other-user");
      }
    }
  );

  test("requires calendar permission without altering working mail credentials", async () => {
    mocks.mailboxRows = [
      [
        "Work",
        "current@example.test",
        "same-google-subject",
        "mailbox-1",
        "https://mail.google.com/",
        "connected",
      ],
    ];
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    await expect(listCalendarAccountsForUser(input)).resolves.toMatchObject({
      accounts: [{ mailboxId: "mailbox-1", status: "needs-permission" }],
    });
    await expect(listCalendarsForUser(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(request).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(
      mocks.query.mock.calls.every(([query]) => query.startsWith("select"))
    ).toBeTruthy();
  });

  test("keeps an unmatched legacy account visible until its own Gmail mailbox is connected", async () => {
    mocks.mailboxRows = [];
    await expect(listCalendarAccountsForUser(input)).resolves.toMatchObject({
      accounts: [
        { id: input.connectionId, mailboxId: null, status: "needs-mailbox" },
      ],
    });
    await expect(listCalendarsForUser(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  test("legacy aliases execute solely through the matched Gmail token and preserve the requested ID", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        items: [
          {
            accessRole: "owner",
            id: "calendar-1",
            summary: "Work",
            timeZone: "UTC",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", request);
    await expect(listCalendarsForUser(input)).resolves.toMatchObject({
      calendars: [
        { calendarId: "calendar-1", connectionId: input.connectionId },
      ],
    });
    expect(mocks.decrypt.mock.calls[0]?.[0]).toBe("gmail-access");
    expect(request).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { authorization: "Bearer gmail-access" },
      })
    );
    for (const [query] of mocks.query.mock.calls.filter(([sql]) =>
      sql.includes('from "connectorCredential"')
    )) {
      expect(query).not.toContain('"encryptedAccessToken"');
      expect(query).not.toContain('"encryptedRefreshToken"');
    }
  });

  test("a Calendar 401 refreshes the selected Gmail credential once", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({
          access_token: "refreshed-token",
          expires_in: 3600,
          token_type: "Bearer",
        })
      )
      .mockResolvedValueOnce(Response.json({ items: [] }));
    vi.stubGlobal("fetch", request);
    await expect(listCalendarsForUser(input)).resolves.toMatchObject({
      calendars: [],
    });
    expect(request).toHaveBeenCalledTimes(3);
    const refreshBody = request.mock.calls[1]?.[1]?.body;
    expect(
      refreshBody instanceof URLSearchParams && refreshBody.get("refresh_token")
    ).toBe("gmail-refresh");
    expect(
      new Headers(request.mock.calls[2]?.[1]?.headers).get("authorization")
    ).toBe("Bearer refreshed-token");
  });

  test("Calendar reads respect retryUnauthorized false", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", request);
    await expect(
      listCalendarsForUser({ ...input, retryUnauthorized: false })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(request).toHaveBeenCalledOnce();
    expect(
      mocks.query.mock.calls.every(([query]) => query.startsWith("select"))
    ).toBeTruthy();
  });

  test.each(["revoked refresh grant", "repeated authorization denial"])(
    "requests reconnection immediately after %s",
    async (failure) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(
          failure === "revoked refresh grant"
            ? Response.json({ error: "invalid_grant" }, { status: 400 })
            : Response.json({
                access_token: "refreshed-token",
                expires_in: 3600,
                token_type: "Bearer",
              })
        )
        .mockResolvedValueOnce(new Response(null, { status: 401 }));
      vi.stubGlobal("fetch", request);
      await expect(listCalendarsForUser(input)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        status: 401,
      });
      expect(
        mocks.query.mock.calls.some(
          ([query, params]) =>
            query.startsWith('update "mailbox"') &&
            params.includes("needs_reconnect")
        )
      ).toBeTruthy();
    }
  );

  test("a Calendar permission denial does not revoke the Gmail mailbox", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", request);
    await expect(listCalendarsForUser(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(request).toHaveBeenCalledOnce();
    expect(
      mocks.query.mock.calls.every(([query]) => query.startsWith("select"))
    ).toBeTruthy();
  });
});
