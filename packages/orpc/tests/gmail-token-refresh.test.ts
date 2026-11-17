import type * as DatabaseClientModule from "@quieter/database/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { runAuthorizedGmailChatRequest } from "../src/gmail-chat-search";
import {
  decryptSecret,
  encryptSecret,
  getAuthorizedGmailMailbox,
  refreshAuthorizedGmailAccessToken,
  runAuthorizedGmailMailbox,
  rotateGmailCredentialSecrets,
} from "../src/gmail-mailbox-access";
import { callGmail } from "../src/gmail-request";

const fixtures = vi.hoisted(() => {
  const secrets: {
    currentKey: string | undefined;
    encryptedAccessToken: string | null;
    encryptedRefreshToken: string | null;
  } = {
    currentKey: undefined,
    encryptedAccessToken: null,
    encryptedRefreshToken: null,
  };
  return {
    ...secrets,
    beforeCredentialUpdate: vi.fn<() => void>(),
    beforeStatusTransaction: vi.fn<() => void>(),
    expiresAt: new Date(0),
    query:
      vi.fn<
        (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
      >(),
    reads: 0,
    scopes: "",
    status: "connected",
    subject: "owned-subject",
  };
});

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The pg proxy verifies the real credential update sent to the database.
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const database = drizzle(fixtures.query);
  return {
    ...actual,
    db: Object.assign(database, {
      transaction: async <T>(
        operation: (transaction: typeof database) => Promise<T>
      ) => {
        fixtures.beforeStatusTransaction();
        return await operation(database);
      },
    }),
  };
});
vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    requireServerEnv: () => "token-refresh-fixture",
    serverEnv: {
      ...actual.serverEnv,
      get GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT() {
        return fixtures.currentKey;
      },
    },
  };
});

const mailboxInput = { mailboxId: "owned-mailbox", userId: "owner" };

describe("Gmail token refresh grants", () => {
  beforeEach(() => {
    fixtures.currentKey = undefined;
    fixtures.encryptedAccessToken = encryptSecret("previous-access");
    fixtures.encryptedRefreshToken = encryptSecret("owned-refresh");
    fixtures.expiresAt = new Date(0);
    fixtures.reads = 0;
    fixtures.subject = "owned-subject";
    fixtures.beforeCredentialUpdate.mockReset();
    fixtures.beforeStatusTransaction.mockReset();
    fixtures.scopes =
      "openid https://mail.google.com/ https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly existing-extra-grant";
    fixtures.status = "connected";
    // oxlint-disable-next-line eslint/require-await -- The pg proxy applies SQL predicates and assignments without external I/O.
    fixtures.query.mockReset().mockImplementation(async (query, params) => {
      if (query.startsWith('update "gmailCredential"')) {
        fixtures.beforeCredentialUpdate();
      }
      const where = query.slice(query.indexOf(" where "));
      const values = {
        encryptedAccessToken: fixtures.encryptedAccessToken,
        encryptedRefreshToken: fixtures.encryptedRefreshToken,
        googleSubject: fixtures.subject,
      };
      for (const [column, current] of Object.entries(values)) {
        const match = new RegExp(
          `"gmailCredential"\\."${column}" = \\$(?<parameter>\\d+)`,
          "u"
        ).exec(where);
        if (
          match?.groups?.parameter !== undefined &&
          params[Number(match.groups.parameter) - 1] !== current
        ) {
          return { rows: [] };
        }
        if (
          where.includes(`"gmailCredential"."${column}" is null`) &&
          current !== null
        ) {
          return { rows: [] };
        }
      }
      if (query.startsWith("select")) {
        if (query.includes("for no key update")) {
          return {
            rows: [
              [
                fixtures.encryptedAccessToken,
                fixtures.encryptedRefreshToken,
                fixtures.subject,
              ],
            ],
          };
        }
        if (query.includes("for update")) {
          return { rows: [[mailboxInput.mailboxId]] };
        }
        if (query.includes('from "mailbox"')) {
          fixtures.reads += 1;
          return {
            rows: [
              [
                fixtures.expiresAt,
                "owned@example.com",
                fixtures.encryptedAccessToken,
                fixtures.encryptedRefreshToken,
                fixtures.subject,
                mailboxInput.mailboxId,
                fixtures.scopes,
                fixtures.status,
              ],
            ],
          };
        }
        return {
          rows: [
            [
              fixtures.expiresAt,
              fixtures.encryptedAccessToken,
              fixtures.encryptedRefreshToken,
            ],
          ],
        };
      }
      if (query.startsWith('update "gmailCredential"')) {
        const assignments = query.slice(
          query.indexOf(" set "),
          query.indexOf(" where ")
        );
        const access = /"encryptedAccessToken" = \$(?<parameter>\d+)/u.exec(
          assignments
        )?.groups?.parameter;
        const refresh = /"encryptedRefreshToken" = \$(?<parameter>\d+)/u.exec(
          assignments
        )?.groups?.parameter;
        const expiry = /"accessTokenExpiresAt" = \$(?<parameter>\d+)/u.exec(
          assignments
        )?.groups?.parameter;
        const scopes = /"scopes" = \$(?<parameter>\d+)/u.exec(assignments)
          ?.groups?.parameter;
        const accessValue =
          access === undefined ? undefined : params[Number(access) - 1];
        const refreshValue =
          refresh === undefined ? undefined : params[Number(refresh) - 1];
        const expiryValue =
          expiry === undefined ? undefined : params[Number(expiry) - 1];
        const scopesValue =
          scopes === undefined ? undefined : params[Number(scopes) - 1];
        if (typeof accessValue === "string" || accessValue === null) {
          fixtures.encryptedAccessToken = accessValue;
        }
        if (typeof refreshValue === "string" || refreshValue === null) {
          fixtures.encryptedRefreshToken = refreshValue;
        }
        if (typeof expiryValue === "string") {
          fixtures.expiresAt = new Date(expiryValue);
        }
        if (typeof scopesValue === "string") {
          fixtures.scopes = scopesValue;
        }
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
      expect(result.accessToken).toBe("renewed-access");
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
    const previousScopes = fixtures.scopes;
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
    expect(credentialUpdate?.[1]).not.toContain(previousScopes);
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

  test.each([
    {
      currentKey: undefined,
      name: "mailbox",
      request: runAuthorizedGmailMailbox,
    },
    {
      currentKey: "new-fixture-key",
      name: "rotated mailbox",
      request: runAuthorizedGmailMailbox,
    },
    {
      currentKey: undefined,
      name: "chat",
      request: runAuthorizedGmailChatRequest,
    },
  ])(
    "requires reconnection when $name still rejects unchanged refreshed credentials",
    async ({ currentKey, request }) => {
      fixtures.currentKey = currentKey;
      fixtures.expiresAt = new Date(Date.now() + 3_600_000);
      const unauthorized = Object.assign(new Error("Service access revoked."), {
        googleStatus: "UNAUTHENTICATED",
        status: 401,
      });
      const run = vi
        .fn<() => Promise<string>>()
        .mockRejectedValue(unauthorized);
      await expect(request(mailboxInput, run)).rejects.toBeInstanceOf(Error);
      expect(fixtures.status).toBe("needs_reconnect");
    }
  );

  test.each([
    { name: "mailbox", request: runAuthorizedGmailMailbox },
    { name: "chat", request: runAuthorizedGmailChatRequest },
  ])(
    "a late $name rejection preserves a same-subject reconnect",
    async ({ request }) => {
      fixtures.expiresAt = new Date(Date.now() + 3_600_000);
      const unauthorized = Object.assign(new Error("Service access revoked."), {
        googleStatus: "UNAUTHENTICATED",
        status: 401,
      });
      const retryStarted = Promise.withResolvers<boolean>();
      const retry = Promise.withResolvers<never>();
      const run = vi
        .fn<(token: string) => Promise<never>>()
        .mockRejectedValueOnce(unauthorized)
        .mockImplementationOnce(async () => {
          retryStarted.resolve(true);
          return await retry.promise;
        });
      const outcome = (async () => {
        try {
          return await request(mailboxInput, run);
        } catch (error) {
          return error;
        }
      })();
      await retryStarted.promise;
      fixtures.encryptedAccessToken = encryptSecret("reconnected-access");
      fixtures.encryptedRefreshToken = encryptSecret("reconnected-refresh");
      fixtures.expiresAt = new Date(Date.now() + 3_600_000);
      retry.reject(unauthorized);

      await outcome;
      expect(fixtures.status).toBe("connected");
      expect(run).toHaveBeenCalledTimes(2);
    }
  );

  test("allows a send to retry after a temporary token refresh failure without submitting first", async () => {
    const send = vi.fn<() => Promise<string>>().mockResolvedValue("sent");
    const refresh = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error: "server_error" }, { status: 500 })
      )
      .mockResolvedValueOnce(
        Response.json({
          access_token: "renewed-access",
          expires_in: 3600,
          token_type: "Bearer",
        })
      );
    vi.stubGlobal("fetch", refresh);

    await expect(
      callGmail({ userId: mailboxInput.userId }, mailboxInput.mailboxId, send, {
        kind: "send",
      })
    ).rejects.toMatchObject({
      data: { sendNotStarted: true },
      status: 500,
    });
    expect(send).not.toHaveBeenCalled();
    expect(fixtures.status).toBe("connected");
    await expect(
      callGmail({ userId: mailboxInput.userId }, mailboxInput.mailboxId, send, {
        kind: "send",
      })
    ).resolves.toBe("sent");
    expect(send).toHaveBeenCalledOnce();
  });

  test("separates pending refreshes for replaced Google subjects", async () => {
    const started = Promise.withResolvers<boolean>();
    const firstResponse = Promise.withResolvers<Response>();
    const secondResponse = Promise.withResolvers<Response>();
    const refresh = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => {
        if (!(init?.body instanceof URLSearchParams)) {
          throw new Error("Expected a URL-encoded refresh request.");
        }
        const { body } = init;
        if (body.get("refresh_token") === "first-refresh") {
          started.resolve(true);
          return await firstResponse.promise;
        }
        return await secondResponse.promise;
      });
    vi.stubGlobal("fetch", refresh);
    fixtures.subject = "first-subject";
    fixtures.encryptedAccessToken = encryptSecret("first-access");
    fixtures.encryptedRefreshToken = encryptSecret("first-refresh");
    const run = vi
      .fn<
        (
          token: string,
          identity: { googleSubject: string }
        ) => Promise<{ subject: string; token: string }>
      >()
      // oxlint-disable-next-line eslint/require-await -- The typed token runner returns its binding without network I/O.
      .mockImplementation(async (token, identity) => ({
        subject: identity.googleSubject,
        token,
      }));
    const first = runAuthorizedGmailMailbox(mailboxInput, run);
    const firstOutcome = (async () => {
      try {
        return await first;
      } catch (error) {
        return error;
      }
    })();
    await started.promise;
    fixtures.subject = "second-subject";
    fixtures.encryptedAccessToken = encryptSecret("second-access");
    fixtures.encryptedRefreshToken = encryptSecret("second-refresh");
    const second = runAuthorizedGmailMailbox(mailboxInput, run);
    const secondOutcome = (async () => {
      try {
        return await second;
      } catch (error) {
        return error;
      }
    })();
    try {
      await vi.waitFor(() => {
        expect(refresh).toHaveBeenCalledTimes(2);
      });
    } finally {
      firstResponse.resolve(
        Response.json({
          access_token: "renewed-first",
          expires_in: 3600,
          token_type: "Bearer",
        })
      );
      secondResponse.resolve(
        Response.json({
          access_token: "renewed-second",
          expires_in: 3600,
          token_type: "Bearer",
        })
      );
      await Promise.all([firstOutcome, secondOutcome]);
    }
    await expect(firstOutcome).resolves.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(secondOutcome).resolves.toMatchObject({
      subject: "second-subject",
      token: "renewed-second",
    });
    expect(run).toHaveBeenCalledOnce();
    expect(
      fixtures.encryptedAccessToken &&
        decryptSecret(fixtures.encryptedAccessToken)
    ).toBe("renewed-second");
  });

  test("coalesces refreshes for the same Google subject", async () => {
    const response = Promise.withResolvers<Response>();
    const refresh = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => await response.promise);
    vi.stubGlobal("fetch", refresh);
    const first = getAuthorizedGmailMailbox(mailboxInput);
    const second = getAuthorizedGmailMailbox(mailboxInput);
    try {
      await vi.waitFor(() => {
        expect(fixtures.reads).toBe(2);
      });
    } finally {
      response.resolve(
        Response.json({
          access_token: "shared-renewed",
          expires_in: 3600,
          token_type: "Bearer",
        })
      );
    }
    const authorized = await Promise.all([first, second]);
    expect(authorized.map((result) => result.accessToken)).toStrictEqual([
      "shared-renewed",
      "shared-renewed",
    ]);
    expect(refresh).toHaveBeenCalledOnce();
    await authorized[1]?.markNeedsReconnect();
    expect(fixtures.status).toBe("needs_reconnect");
  });

  test("uses the credential returned by a refresh CAS fallback when marking repair", async () => {
    fixtures.beforeCredentialUpdate.mockImplementationOnce(() => {
      fixtures.encryptedAccessToken = encryptSecret("reconnected-access");
      fixtures.encryptedRefreshToken = encryptSecret("reconnected-refresh");
      fixtures.expiresAt = new Date(Date.now() + 3_600_000);
    });
    const prepared = await refreshAuthorizedGmailAccessToken(mailboxInput);
    expect(prepared.accessToken).toBe("reconnected-access");
    await prepared.markNeedsReconnect();
    expect(fixtures.status).toBe("needs_reconnect");
  });

  test("a token not stored after a refresh CAS miss cannot disconnect the current credential", async () => {
    fixtures.beforeCredentialUpdate.mockImplementationOnce(() => {
      fixtures.encryptedAccessToken = encryptSecret("changed-access");
      fixtures.encryptedRefreshToken = encryptSecret("changed-refresh");
    });
    const prepared = await refreshAuthorizedGmailAccessToken(mailboxInput);
    await prepared.markNeedsReconnect();
    expect(fixtures.status).toBe("connected");
  });

  test("a repair marker cannot disable credentials rotated after token preparation", async () => {
    const prepared = await getAuthorizedGmailMailbox(mailboxInput);
    fixtures.currentKey = "new-fixture-key";
    await rotateGmailCredentialSecrets({
      encryptedAccessToken: fixtures.encryptedAccessToken,
      encryptedRefreshToken: fixtures.encryptedRefreshToken,
      googleSubject: fixtures.subject,
      id: mailboxInput.mailboxId,
    });
    await prepared.markNeedsReconnect();
    expect(fixtures.status).toBe("connected");
  });

  test.each(["missing refresh token", "permanent refresh failure"] as const)(
    "marks unchanged credentials for repair after %s",
    async (path) => {
      if (path === "missing refresh token") {
        fixtures.encryptedRefreshToken = null;
      } else {
        vi.stubGlobal(
          "fetch",
          vi
            .fn<typeof fetch>()
            .mockResolvedValue(
              Response.json({ error: "invalid_grant" }, { status: 401 })
            )
        );
      }

      await expect(
        getAuthorizedGmailMailbox(mailboxInput)
      ).rejects.toMatchObject({ code: "MAILBOX_SCOPE_REPAIR_REQUIRED" });
      expect(fixtures.status).toBe("needs_reconnect");
    }
  );

  test.each(["missing refresh token", "permanent refresh failure"] as const)(
    "preserves a newly stored access token after %s",
    async (path) => {
      if (path === "missing refresh token") {
        fixtures.encryptedRefreshToken = null;
      } else {
        vi.stubGlobal(
          "fetch",
          vi
            .fn<typeof fetch>()
            .mockResolvedValue(
              Response.json({ error: "invalid_grant" }, { status: 401 })
            )
        );
      }
      fixtures.beforeStatusTransaction.mockImplementationOnce(() => {
        fixtures.encryptedAccessToken = encryptSecret("reconnected-access");
      });

      await expect(
        getAuthorizedGmailMailbox(mailboxInput)
      ).rejects.toMatchObject({ code: "MAILBOX_SCOPE_REPAIR_REQUIRED" });
      expect(fixtures.status).toBe("connected");
    }
  );

  test("refresh success cannot re-enable a newer credential generation", async () => {
    fixtures.beforeStatusTransaction.mockImplementationOnce(() => {
      fixtures.encryptedRefreshToken = encryptSecret("new-revoked-refresh");
      fixtures.status = "needs_reconnect";
    });

    const prepared = await refreshAuthorizedGmailAccessToken(mailboxInput);
    expect(prepared.accessToken).toBe("renewed-access");
    expect(fixtures.status).toBe("needs_reconnect");
  });

  test("does not mark a replacement account disconnected after the old refresh fails", async () => {
    const started = Promise.withResolvers<boolean>();
    const response = Promise.withResolvers<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async () => {
        started.resolve(true);
        return await response.promise;
      })
    );
    const original = getAuthorizedGmailMailbox(mailboxInput);
    const outcome = (async () => {
      try {
        return await original;
      } catch (error) {
        return error;
      }
    })();
    await started.promise;
    fixtures.subject = "replacement-subject";
    fixtures.encryptedAccessToken = encryptSecret("replacement-access");
    fixtures.encryptedRefreshToken = encryptSecret("replacement-refresh");
    response.resolve(
      Response.json({ error: "invalid_grant" }, { status: 401 })
    );
    await expect(outcome).resolves.toMatchObject({
      code: "MAILBOX_SCOPE_REPAIR_REQUIRED",
    });
    expect(fixtures.status).toBe("connected");
  });

  test("a retry does not pair a replacement token with the initial identity", async () => {
    fixtures.expiresAt = new Date(Date.now() + 3_600_000);
    const unauthorized = new Error("Prepared service access expired.");
    // oxlint-disable-next-line eslint/require-await -- The typed runner rejects after changing fixture credentials without network I/O.
    const run = vi.fn<() => Promise<never>>().mockImplementation(async () => {
      fixtures.subject = "replacement-subject";
      fixtures.expiresAt = new Date(0);
      fixtures.encryptedAccessToken = encryptSecret("replacement-access");
      fixtures.encryptedRefreshToken = encryptSecret("replacement-refresh");
      throw unauthorized;
    });
    await expect(
      runAuthorizedGmailMailbox(
        { ...mailboxInput, isUnauthorized: (error) => error === unauthorized },
        run
      )
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(run).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(fixtures.status).toBe("connected");
  });

  test("rotates secrets without changing a valid account's prepared identity", async () => {
    fixtures.expiresAt = new Date(Date.now() + 3_600_000);
    fixtures.currentKey = "new-fixture-key";
    const result = await getAuthorizedGmailMailbox(mailboxInput);
    expect(result.accessToken).toBe("previous-access");
    expect(result.mailbox.googleSubject).toBe("owned-subject");
    expect(
      fixtures.encryptedAccessToken &&
        decryptSecret(fixtures.encryptedAccessToken)
    ).toBe("previous-access");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("secret rotation cannot rewrite a different subject's credential", async () => {
    const oldAccess = fixtures.encryptedAccessToken;
    const oldRefresh = fixtures.encryptedRefreshToken;
    fixtures.currentKey = "new-fixture-key";
    fixtures.beforeCredentialUpdate.mockImplementationOnce(() => {
      fixtures.subject = "replacement-subject";
    });
    const result = await rotateGmailCredentialSecrets({
      encryptedAccessToken: oldAccess,
      encryptedRefreshToken: oldRefresh,
      googleSubject: "owned-subject",
      id: mailboxInput.mailboxId,
    });
    expect(result.rotated).toBeFalsy();
    expect(fixtures.encryptedAccessToken).toBe(oldAccess);
    expect(fixtures.encryptedRefreshToken).toBe(oldRefresh);
  });
});
