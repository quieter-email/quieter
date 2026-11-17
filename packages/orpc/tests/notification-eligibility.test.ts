import { createRouterClient } from "@orpc/server";
import type * as DatabaseClientModule from "@quieter/database/client";
import { db } from "@quieter/database/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { REQUIRED_GMAIL_SCOPES } from "../src/gmail-mailbox-access";
import {
  getNewMailNotificationEligibility,
  newMailNotificationEligibilityInputSchema,
  newMailNotificationEligibilityOutputSchema,
} from "../src/mail/notification-eligibility";
import type { getManagedMessageCategoryCondition } from "../src/managed-mail/messages/service";
import { protectedProcedure } from "../src/routers/base";

const fixture = vi.hoisted(() => {
  const hooks: { beforeMetadataReturn?: () => void | Promise<void> } = {};
  return {
    authenticated: true,
    credential: {
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      emailAddress: "owned@example.test",
      encryptedAccessToken: "owned-access",
      encryptedRefreshToken: "owned-refresh",
      googleSubject: "owned-google-subject",
      id: "owned-mailbox",
      ownerUserId: "owner",
      provider: "gmail",
      scopes: "",
      status: "connected",
    },
    disconnected: false,
    hooks,
    labels: ["INBOX", "UNREAD"],
    messageId: "exact-message",
    query:
      vi.fn<
        (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
      >(),
    responseStatus: 200,
    threadId: "exact-thread",
  };
});

// oxlint-disable-next-line vitest/prefer-import-in-mock -- This exercises the candidate's actual native select through Drizzle.
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const database = drizzle(fixture.query);
  Object.defineProperty(database, "transaction", {
    value: async <Result>(
      run: (transaction: typeof database) => Promise<Result>
    ) => await run(database),
  });
  return { ...actual, db: database };
});
vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    requireServerEnv: () => "synthetic-146-test-value",
    serverEnv: {
      ...actual.serverEnv,
      GMAIL_TOKEN_ENCRYPTION_KEY_CURRENT: undefined,
    },
  };
});
vi.mock(import("../src/gmail-credential-crypto"), () => ({
  decryptGmailCredentialSecret: (value: string) => value,
  encryptGmailCredentialSecret: (value: string) => value,
}));
vi.mock(import("../src/mailbox/service"), async () => {
  const { getMailboxCapabilities } = await import("@quieter/mail/data-plane");
  return {
    // oxlint-disable-next-line eslint/require-await -- The synthetic transport retains the asynchronous service contract.
    assertAccessibleMailbox: async (scope: {
      mailboxId: string;
      userId: string;
    }) => ({
      capabilities: getMailboxCapabilities({ provider: "gmail" }),
      contentRevision: 0,
      id: scope.mailboxId,
      organizationId: "synthetic-organization",
      provider: "gmail" as const,
    }),
  };
});
vi.mock(import("../src/managed-mail/messages/service"), () => ({
  getManagedMessageCategoryCondition:
    vi.fn<typeof getManagedMessageCategoryCondition>(),
}));
vi.mock(import("@quieter/auth/session"), () => ({
  // oxlint-disable-next-line eslint/require-await -- The synthetic session retains the asynchronous authentication contract.
  getSessionWithOrganization: async () =>
    fixture.authenticated
      ? {
          session: {
            createdAt: new Date(0),
            expiresAt: new Date(Date.now() + 3_600_000),
            id: "signed-session",
            token: "synthetic-session-token",
            updatedAt: new Date(0),
            userId: "owner",
          },
          user: {
            createdAt: new Date(0),
            email: "owner@example.test",
            emailVerified: true,
            id: "owner",
            name: "Owner",
            updatedAt: new Date(0),
          },
        }
      : null,
}));

const input = {
  mailboxId: "owned-mailbox",
  messageId: "exact-message",
  threadId: "exact-thread",
};
const route = {
  getNewMailNotificationEligibility: protectedProcedure
    .input(newMailNotificationEligibilityInputSchema)
    .output(newMailNotificationEligibilityOutputSchema)
    .handler(getNewMailNotificationEligibility),
};
const request = async (signal?: AbortSignal) => {
  const client = createRouterClient(route, {
    context: { db, headers: new Headers(), signal },
  });
  return await client.getNewMailNotificationEligibility(input);
};

describe("passive Gmail eligibility boundary", () => {
  beforeEach(() => {
    fixture.authenticated = true;
    fixture.hooks.beforeMetadataReturn = undefined;
    fixture.disconnected = false;
    Object.assign(fixture.credential, {
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      emailAddress: "owned@example.test",
      encryptedAccessToken: "owned-access",
      encryptedRefreshToken: "owned-refresh",
      googleSubject: "owned-google-subject",
      ownerUserId: "owner",
      provider: "gmail",
      scopes: REQUIRED_GMAIL_SCOPES.join(" "),
      status: "connected",
    });
    fixture.labels = ["INBOX", "UNREAD"];
    fixture.messageId = input.messageId;
    fixture.threadId = input.threadId;
    fixture.responseStatus = 200;
    // oxlint-disable-next-line eslint/require-await -- The SQL proxy returns synthetic rows without external I/O.
    fixture.query.mockReset().mockImplementation(async (query, params) => {
      if (!query.startsWith("select")) {
        throw new Error("This read must not perform a database mutation.");
      }
      const record = fixture.credential;
      if (
        fixture.disconnected ||
        !params.includes(record.id) ||
        !params.includes(record.ownerUserId) ||
        !params.includes(record.provider)
      ) {
        return { rows: [] };
      }
      return {
        rows: [
          [
            record.accessTokenExpiresAt,
            new Date(0),
            record.emailAddress,
            record.encryptedAccessToken,
            record.encryptedRefreshToken,
            record.googleSubject,
            record.id,
            new Date(0),
            record.scopes,
            record.status,
          ],
        ],
      };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (resource, options) => {
        const url = new URL(
          resource instanceof Request ? resource.url : resource
        );
        if (
          url.origin !== "https://gmail.googleapis.com" ||
          options?.method !== "GET" ||
          url.pathname !== `/gmail/v1/users/me/threads/${input.threadId}` ||
          url.searchParams.get("format") !== "minimal" ||
          url.searchParams.get("fields") !== "id,messages(id,labelIds)"
        ) {
          throw new Error(
            "Only exact minimal Gmail thread metadata is permitted."
          );
        }
        await fixture.hooks.beforeMetadataReturn?.();
        return fixture.responseStatus === 200
          ? Response.json({
              id: fixture.threadId,
              messages: [{ id: fixture.messageId, labelIds: fixture.labels }],
            })
          : Response.json(
              {
                error: {
                  message: "Synthetic metadata failure",
                  status:
                    fixture.responseStatus === 429
                      ? "RESOURCE_EXHAUSTED"
                      : "NOT_FOUND",
                },
              },
              { status: fixture.responseStatus }
            );
      })
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  test("the current authenticated actor gets only eligibility", async () => {
    await expect(request()).resolves.toStrictEqual({ eligible: true });
  });

  test("session authentication and strict input exclude a client actor", async () => {
    fixture.authenticated = false;
    await expect(request()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(
      newMailNotificationEligibilityInputSchema.safeParse({
        ...input,
        userId: "another-user",
      }).success
    ).toBeFalsy();
    expect(
      newMailNotificationEligibilityInputSchema.safeParse({
        ...input,
        threadId: " ",
      }).success
    ).toBeFalsy();
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    "subject",
    "refresh",
    "account",
    "owner",
    "provider",
    "status",
    "scopes",
    "token",
  ] as const)(
    "a current %s change while metadata is pending cannot return true",
    async (kind) => {
      fixture.hooks.beforeMetadataReturn = () => {
        if (kind === "subject") {
          fixture.credential.googleSubject = "replacement-subject";
        }
        if (kind === "refresh") {
          fixture.credential.encryptedRefreshToken = "replacement-refresh";
        }
        if (kind === "account") {
          fixture.credential.emailAddress = "replacement@example.test";
        }
        if (kind === "owner") {
          fixture.credential.ownerUserId = "another-owner";
        }
        if (kind === "provider") {
          fixture.credential.provider = "managed";
        }
        if (kind === "status") {
          fixture.credential.status = "needs_reconnect";
        }
        if (kind === "scopes") {
          fixture.credential.scopes = "openid";
        }
        if (kind === "token") {
          fixture.credential.encryptedAccessToken = "replacement-access";
        }
      };
      const observed = await request().then(
        (result) => ({ result }),
        (error: unknown) => ({ error })
      );
      const expected =
        kind === "owner" || kind === "provider"
          ? { error: { code: "NOT_FOUND" } }
          : { result: { eligible: false } };
      expect(observed).toMatchObject(expected);
    }
  );

  test("disconnect during pending metadata fails the final native read", async () => {
    fixture.hooks.beforeMetadataReturn = () => {
      fixture.disconnected = true;
    };
    await expect(request()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("metadata expiring a token does not start another authorization refresh", async () => {
    fixture.hooks.beforeMetadataReturn = () => {
      fixture.credential.accessTokenExpiresAt = new Date(0);
    };
    await expect(request()).resolves.toStrictEqual({ eligible: true });
    expect(fetch).toHaveBeenCalledOnce();
  });

  test.each([
    { labels: [] },
    { labels: ["INBOX"] },
    { labels: ["UNREAD"] },
    { labels: ["INBOX", "UNREAD", "SENT"] },
    { labels: ["INBOX", "UNREAD", "DRAFT"] },
    { labels: ["INBOX", "UNREAD", "SPAM"] },
    { labels: ["INBOX", "UNREAD", "TRASH"] },
  ])(
    "the exact message must be incoming unread Inbox %#",
    async ({ labels }) => {
      fixture.labels = labels;
      await expect(request()).resolves.toStrictEqual({ eligible: false });
    }
  );

  test.each(["message", "thread"] as const)(
    "a different %s cannot satisfy the exact request",
    async (kind) => {
      if (kind === "message") {
        fixture.messageId = "another-message";
      }
      if (kind === "thread") {
        fixture.threadId = "another-thread";
      }
      await expect(request()).resolves.toStrictEqual({ eligible: false });
    }
  );

  test("a native 404 is negative and a 429 remains a retryable failure", async () => {
    fixture.responseStatus = 404;
    await expect(request()).resolves.toStrictEqual({ eligible: false });
    fixture.responseStatus = 429;
    await expect(request()).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  test("a forced refresh cannot turn native scopes lost during metadata into eligible true", async () => {
    const nativeRead = fixture.query.getMockImplementation();
    if (nativeRead === undefined) {
      throw new Error("Native read fixture is required.");
    }
    fixture.query.mockImplementation(async (query, params) => {
      if (query.startsWith('update "gmailCredential"')) {
        fixture.credential.encryptedAccessToken = "renewed-access";
        fixture.credential.accessTokenExpiresAt = new Date(
          Date.now() + 3_600_000
        );
        fixture.credential.scopes = REQUIRED_GMAIL_SCOPES.join(" ");
        return { rows: [[fixture.credential.id]] };
      }
      if (query.startsWith('update "mailbox"')) {
        return { rows: [] };
      }
      return await nativeRead(query, params);
    });
    const normalMetadata = vi.mocked(fetch).getMockImplementation();
    if (normalMetadata === undefined) {
      throw new Error("Metadata fixture is required.");
    }
    let expired = false;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (resource, options) => {
        const url = new URL(
          resource instanceof Request ? resource.url : resource
        );
        if (
          url.origin === "https://oauth2.googleapis.com" &&
          options?.method === "POST"
        ) {
          return Response.json({
            access_token: "renewed-access",
            expires_in: 3600,
            scope: REQUIRED_GMAIL_SCOPES.join(" "),
            token_type: "Bearer",
          });
        }
        if (!expired) {
          expired = true;
          fixture.credential.scopes = "openid";
          return Response.json(
            { error: { status: "UNAUTHENTICATED" } },
            { status: 401 }
          );
        }
        return await normalMetadata(resource, options);
      })
    );
    await expect(request()).resolves.toStrictEqual({ eligible: false });
    expect(fixture.credential.scopes).toContain("https://mail.google.com/");
  });

  test("cancellation is not a successful negative observation", async () => {
    const controller = new AbortController();
    fixture.hooks.beforeMetadataReturn = () => {
      controller.abort(new Error("Cancelled"));
    };
    await expect(request(controller.signal)).rejects.toThrow("Cancelled");
  });
});
