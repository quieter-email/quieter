import type * as DatabaseClientModule from "@quieter/database/client";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { getGmailMailboxCapacity } from "../src/mailbox/gmail-capacity";
import {
  completeGmailOAuth,
  getGmailOAuthCallbackContext,
  startGmailOAuth,
} from "../src/mailbox/service";

const mocks = vi.hoisted(() => ({
  capacity: vi.fn<typeof getGmailMailboxCapacity>(),
  query:
    vi.fn<
      (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
  session: vi.fn<() => Promise<unknown>>(),
}));

vi.mock(import("@quieter/env/server"), async (importOriginal) => ({
  ...(await importOriginal()),
  requireServerEnv: (name) =>
    name === "BETTER_AUTH_URL" ? "https://quieter.example" : "oauth-fixture",
}));
vi.mock(import("../src/mailbox/gmail-capacity"), async (importOriginal) => ({
  ...(await importOriginal()),
  getGmailMailboxCapacity: mocks.capacity,
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The pg proxy exercises the generated atomic delete condition.
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return { ...actual, db: drizzle(mocks.query) };
});
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The callback only needs these session identity fields.
vi.mock("@quieter/auth/session", () => ({
  getSessionWithOrganization: mocks.session,
}));

describe("Gmail OAuth state consumption", () => {
  beforeEach(() => {
    mocks.capacity.mockReset().mockResolvedValue({ limit: 5, used: 0 });
    mocks.query.mockReset().mockResolvedValue({ rows: [] });
    mocks.session.mockReset().mockResolvedValue({
      session: { id: "session-id" },
      user: { id: "owner-id" },
    });
  });

  test("atomically consumes only an unexpired state owned by the signed-in user", async () => {
    await expect(
      completeGmailOAuth({
        code: "authorization-code",
        headers: new Headers(),
        state: "opaque-state",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
    });

    const [query, params] = mocks.query.mock.calls[0] ?? [];
    expect(query).toContain('delete from "gmailOAuthState"');
    expect(query).toContain('"gmailOAuthState"."id" = $1');
    expect(query).toContain('"gmailOAuthState"."userId" = $2');
    expect(query).toContain('"gmailOAuthState"."expiresAt" > $3');
    expect(params).toContain("opaque-state");
    expect(params).toContain("owner-id");
  });

  test("reads stored navigation only from state owned by the signed-in user, including expired requests", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [["reconnect-mailbox", "/calendar?view=week"]],
    });
    await expect(
      getGmailOAuthCallbackContext({
        headers: new Headers(),
        state: "opaque-state",
      })
    ).resolves.toMatchObject({
      mailboxId: "reconnect-mailbox",
      returnTo: "/calendar?view=week",
    });
    const [query, params] = mocks.query.mock.calls[0] ?? [];
    expect(query).toContain('"gmailOAuthState"."id" = $1');
    expect(query).toContain('"gmailOAuthState"."userId" = $2');
    expect(query).not.toContain('"expiresAt"');
    expect(query).not.toContain("delete");
    expect(params).toContain("opaque-state");
    expect(params).toContain("owner-id");
  });

  test("does not read reconnect context without an authenticated session", async () => {
    mocks.session.mockResolvedValueOnce(null);
    await expect(
      getGmailOAuthCallbackContext({
        headers: new Headers(),
        state: "opaque-state",
      })
    ).resolves.toBeNull();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  test("does not expose another user's connection context", async () => {
    await expect(
      getGmailOAuthCallbackContext({
        headers: new Headers(),
        state: "another-users-state",
      })
    ).resolves.toBeNull();
    const [query, params] = mocks.query.mock.calls[0] ?? [];
    expect(query).toContain('"gmailOAuthState"."userId" = $2');
    expect(params).toContain("owner-id");
    expect(query).not.toContain("delete");
  });

  test.each([
    "https://outside.example/calendar",
    "//outside.example/calendar",
    "/\\outside.example/calendar",
    "/calendar\n/next",
    "\t/calendar",
    "/calendar\u0000",
    "/calendar\u007F",
    "/..//outside.example/calendar",
    "/%2e%2e//outside.example/calendar",
  ])("rejects unsafe stored return navigation %j", async (returnTo) => {
    mocks.query.mockResolvedValueOnce({ rows: [[null, returnTo]] });
    await expect(
      getGmailOAuthCallbackContext({
        headers: new Headers(),
        state: "opaque-state",
      })
    ).resolves.toMatchObject({ returnTo: "/settings" });
  });

  test("keeps the original calendar route when reconnecting the owned Google account", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [["owned@example.com", "team-id"]] })
      .mockResolvedValueOnce({ rows: [["membership-id"]] });
    const result = await startGmailOAuth({
      loginHint: "other@example.com",
      mailboxId: "owned-mailbox",
      returnTo: "/calendar?view=week",
      userId: "owner-id",
    });
    const authorizationUrl = new URL(result.authorizationUrl);
    expect(authorizationUrl.searchParams.get("login_hint")).toBe(
      "owned@example.com"
    );
    expect(authorizationUrl.searchParams.get("prompt")).toBe("consent");
    const scopes = authorizationUrl.searchParams.get("scope")?.split(" ");
    expect(scopes).toContain("https://mail.google.com/");
    expect(scopes).toContain("https://www.googleapis.com/auth/calendar.events");
    expect(scopes).toContain(
      "https://www.googleapis.com/auth/calendar.calendarlist"
    );
    const insertion = mocks.query.mock.calls.find(([query]) =>
      query.startsWith('insert into "gmailOAuthState"')
    );
    expect(insertion?.[1]).toContain("/calendar?view=week");
  });

  test("keeps the account chooser when connecting an unknown account", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [["membership-id"]] });
    const result = await startGmailOAuth({
      organizationId: "team-id",
      userId: "owner-id",
    });
    const authorizationUrl = new URL(result.authorizationUrl);
    expect(authorizationUrl.searchParams.get("prompt")).toContain(
      "select_account"
    );
    expect(authorizationUrl.searchParams.has("login_hint")).toBeFalsy();
  });
});
