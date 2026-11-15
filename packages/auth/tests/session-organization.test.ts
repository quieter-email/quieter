import type * as DatabaseClientModule from "@quieter/database/client";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { getSessionWithOrganization } from "../src/session";

type SessionFixture = {
  user: { defaultOrganizationProvisioned?: boolean; id: string };
};

const { getSession, provision, query } = vi.hoisted(() => ({
  getSession: vi.fn<() => Promise<SessionFixture | null>>(),
  provision:
    vi.fn<(input: { id: string }) => Promise<{ organizationIds: string[] }>>(),
  query:
    vi.fn<
      (sql: string, parameters: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Only the session API is needed by this fixture.
vi.mock("../src/lazy-auth", () => ({
  lazyAuth: () => ({ api: { getSession } }),
}));
vi.mock(import("../src/organization"), () => ({
  ensureUserOrganizationState: provision,
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Exercise the real Drizzle owner predicate without opening a database.
vi.mock("@quieter/database/client", async (original) => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return {
    ...(await original<typeof DatabaseClientModule>()),
    db: drizzle(query),
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Preserve the request scope contract.
    withRequestDatabaseClient: async (callback: () => Promise<unknown>) =>
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Execute the supplied request scope.
      await callback(),
  };
});

describe("session organization provisioning", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    query.mockResolvedValue({ rows: [] });
    provision.mockResolvedValue({ organizationIds: ["team"] });
  });

  test("authenticated reads do not repeat completed provisioning", async () => {
    const session = {
      user: { defaultOrganizationProvisioned: true, id: "owner" },
    };
    getSession.mockResolvedValue(session);
    await expect(getSessionWithOrganization(new Headers())).resolves.toBe(
      session
    );
    await expect(getSessionWithOrganization(new Headers())).resolves.toBe(
      session
    );
    expect(provision).not.toHaveBeenCalled();
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  test.each([false, undefined])(
    "provisions legacy state %s before returning completion",
    async (flag) => {
      const session = {
        user: { defaultOrganizationProvisioned: flag, id: "owner" },
      };
      getSession.mockResolvedValue(session);
      await expect(
        getSessionWithOrganization(new Headers())
      ).resolves.toMatchObject({
        user: { defaultOrganizationProvisioned: true, id: "owner" },
      });
      expect(provision).toHaveBeenCalledWith(session.user);
      expect(query).not.toHaveBeenCalled();
      expect(session.user.defaultOrganizationProvisioned).toBe(flag);
    }
  );

  test("repairs an owned legacy Gmail mailbox before returning the session", async () => {
    const session = {
      user: { defaultOrganizationProvisioned: true, id: "owner" },
    };
    getSession.mockResolvedValue(session);
    query.mockResolvedValue({ rows: [["legacy-mailbox"]] });
    await expect(
      getSessionWithOrganization(new Headers())
    ).resolves.toMatchObject(session);
    expect(provision).toHaveBeenCalledWith(session.user);
  });

  test("does not repair another owner's or an associated mailbox", async () => {
    const mailboxes = [
      { organization: null, owner: "other", provider: "gmail" },
      { organization: "team", owner: "owner", provider: "gmail" },
      { organization: null, owner: "owner", provider: "managed" },
    ];
    query.mockImplementation(async (sql, parameters) => {
      expect(sql).toMatch(/"mailbox"\."ownerUserId" = \$1/u);
      expect(sql).toMatch(/"mailbox"\."provider" = \$2/u);
      expect(sql).toMatch(/"mailbox"\."organizationId" is null/u);
      expect(sql).toMatch(/limit \$3/u);
      return await Promise.resolve({
        rows: mailboxes
          .filter(
            (record) =>
              record.owner === parameters[0] &&
              record.provider === parameters[1] &&
              record.organization === null
          )
          .slice(0, Number(parameters[2]))
          .map(() => ["legacy-mailbox"]),
      });
    });
    getSession.mockResolvedValue({
      user: { defaultOrganizationProvisioned: true, id: "owner" },
    });
    await getSessionWithOrganization(new Headers());
    expect(provision).not.toHaveBeenCalled();
  });

  test("rejects a provisioned session when legacy repair fails", async () => {
    getSession.mockResolvedValue({
      user: { defaultOrganizationProvisioned: true, id: "owner" },
    });
    query.mockResolvedValue({ rows: [["legacy-mailbox"]] });
    provision.mockRejectedValue(new Error("repair unavailable"));
    await expect(getSessionWithOrganization(new Headers())).rejects.toThrow(
      "repair unavailable"
    );
  });

  test("does not report a usable session when provisioning fails", async () => {
    getSession.mockResolvedValue({ user: { id: "owner" } });
    provision.mockRejectedValue(new Error("database unavailable"));
    await expect(getSessionWithOrganization(new Headers())).rejects.toThrow(
      "database unavailable"
    );
  });

  test("leaves anonymous requests anonymous", async () => {
    getSession.mockResolvedValue(null);
    await expect(getSessionWithOrganization(new Headers())).resolves.toBeNull();
    expect(provision).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});
