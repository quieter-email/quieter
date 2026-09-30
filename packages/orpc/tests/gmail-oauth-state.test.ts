import type * as DatabaseClientModule from "@quieter/database/client";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { completeGmailOAuth } from "../src/mailbox/service";

const mocks = vi.hoisted(() => ({
  query:
    vi.fn<
      (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
  session: vi.fn<() => Promise<unknown>>(),
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
});
