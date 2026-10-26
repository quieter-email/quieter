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
  encryptSecret,
  getAuthorizedGmailMailbox,
  refreshAuthorizedGmailAccessToken,
  runAuthorizedGmailMailbox,
} from "../src/gmail-mailbox-access";

const fixtures = vi.hoisted(() => ({
  expiresAt: new Date(0),
  query:
    vi.fn<
      (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
  scopes: "",
  status: "connected",
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The pg proxy verifies the real credential update sent to the database.
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return { ...actual, db: drizzle(fixtures.query) };
});
vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    requireServerEnv: () => "token-refresh-fixture",
    serverEnv: {
      ...actual.serverEnv,
      GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT: undefined,
    },
  };
});

const mailboxInput = { mailboxId: "owned-mailbox", userId: "owner" };

describe("Gmail token refresh grants", () => {
  beforeEach(() => {
    fixtures.expiresAt = new Date(0);
    fixtures.scopes =
      "openid https://mail.google.com/ https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly existing-extra-grant";
    fixtures.status = "connected";
    // oxlint-disable-next-line eslint/require-await -- The pg proxy returns fixture rows without I/O.
    fixtures.query.mockReset().mockImplementation(async (query, params) => {
      if (query.startsWith("select")) {
        return {
          rows: [
            [
              fixtures.expiresAt,
              "owned@example.com",
              encryptSecret("previous-access"),
              encryptSecret("owned-refresh"),
              mailboxInput.mailboxId,
              fixtures.scopes,
              fixtures.status,
            ],
          ],
        };
      }
      if (query.startsWith('update "gmailCredential"')) {
        return { rows: [[mailboxInput.mailboxId]] };
      }
      if (query.startsWith('update "mailbox"')) {
        const [status] = params;
        if (typeof status === "string") {
          fixtures.status = status;
        }
      }
      return { rows: [] };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          access_token: "renewed-access",
          expires_in: 3600,
          token_type: "Bearer",
        })
      )
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  test.each(["initial", "forced"] as const)(
    "preserves the granted scopes when the %s refresh omits scope",
    async (path) => {
      const result =
        path === "initial"
          ? await getAuthorizedGmailMailbox(mailboxInput)
          : await refreshAuthorizedGmailAccessToken(mailboxInput);
      const token = typeof result === "string" ? result : result.accessToken;
      expect(token).toBe("renewed-access");
      const credentialUpdate = fixtures.query.mock.calls.find(([query]) =>
        query.startsWith('update "gmailCredential"')
      );
      expect(credentialUpdate?.[1]).toContain(fixtures.scopes);
    }
  );

  test("does not invent calendar grants for a mail-only refresh", async () => {
    fixtures.scopes = "openid https://mail.google.com/";
    const result = await getAuthorizedGmailMailbox(mailboxInput);
    expect(result.mailbox.scopes).toBe("openid https://mail.google.com/");
    const credentialUpdate = fixtures.query.mock.calls.find(([query]) =>
      query.startsWith('update "gmailCredential"')
    );
    expect(credentialUpdate?.[1]).toContain("openid https://mail.google.com/");
  });

  test("stores the provider's explicit grant update", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          access_token: "renewed-access",
          expires_in: 3600,
          scope: "openid https://mail.google.com/",
          token_type: "Bearer",
        })
      )
    );
    await refreshAuthorizedGmailAccessToken(mailboxInput);
    const credentialUpdate = fixtures.query.mock.calls.find(([query]) =>
      query.startsWith('update "gmailCredential"')
    );
    expect(credentialUpdate?.[1]).toContain("openid https://mail.google.com/");
    expect(credentialUpdate?.[1]).not.toContain(fixtures.scopes);
  });

  test("retries an authorized service using its own authentication error", async () => {
    fixtures.expiresAt = new Date(Date.now() + 3_600_000);
    const unauthorized = new Error("Service access expired.");
    const run = vi
      .fn<(token: string) => Promise<string>>()
      .mockRejectedValueOnce(unauthorized)
      .mockResolvedValueOnce("renewed-access");
    await expect(
      runAuthorizedGmailMailbox(
        { ...mailboxInput, isUnauthorized: (error) => error === unauthorized },
        run
      )
    ).resolves.toBe("renewed-access");
    expect(run.mock.calls.map(([token]) => token)).toStrictEqual([
      "previous-access",
      "renewed-access",
    ]);
  });

  test("requires reconnection when the service still rejects the refreshed token", async () => {
    fixtures.expiresAt = new Date(Date.now() + 3_600_000);
    const unauthorized = new Error("Service access revoked.");
    const run = vi.fn<() => Promise<string>>().mockRejectedValue(unauthorized);
    await expect(
      runAuthorizedGmailMailbox(
        { ...mailboxInput, isUnauthorized: (error) => error === unauthorized },
        run
      )
    ).rejects.toMatchObject({ code: "MAILBOX_SCOPE_REPAIR_REQUIRED" });
    expect(fixtures.status).toBe("needs_reconnect");
  });
});
