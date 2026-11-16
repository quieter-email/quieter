/* oxlint-disable eslint/require-await -- SQL and fetch doubles preserve asynchronous service boundaries. */
import { ORPCError } from "@orpc/server";
import { calendarEventDraftSchema } from "@quieter/calendar";
import type * as DatabaseClientModule from "@quieter/database/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { createMicrosoftCalendarEventForUser } from "../src/calendar/microsoft";
import {
  assertConnectorWriteAccess,
  getConnectorConnectionForUser,
} from "../src/connectors/runtime";
import { callRegisteredConnectorTool } from "../src/connectors/tool-registry";

const state = vi.hoisted(() => ({
  credentialRead: vi.fn<() => Promise<void>>(),
  providerAccountId: "account-owned",
  query:
    vi.fn<
      (query: string, parameters: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
  scopes: "data:read_write",
  status: "connected",
  transactionActive: false,
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The proxy executes the native ownership and grant predicates.
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const transaction = drizzle(state.query);
  return {
    ...actual,
    db: {
      select: (...input: Parameters<typeof transaction.select>) => {
        if (state.transactionActive) {
          throw new Error(
            "The available connection belongs to the transaction."
          );
        }
        return transaction.select(...input);
      },
      transaction: async <Result>(
        run: (reader: typeof transaction) => Promise<Result>
      ) => {
        state.transactionActive = true;
        try {
          return await run(transaction);
        } finally {
          state.transactionActive = false;
        }
      },
    },
  };
});
vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    requireServerEnv: () => "fixture-key",
    serverEnv: {
      ...actual.serverEnv,
      QUIETER_DEPLOYMENT_ENV: "production" as const,
    },
  };
});
vi.mock(import("../src/gmail-credential-crypto"), () => ({
  decryptGmailCredentialSecret: (value: string) => value,
  encryptGmailCredentialSecret: (value: string) => value,
}));

const operation = {
  arguments: { content: "Review request" },
  connectionId: "connection-owned",
  effect: "write" as const,
  provider: "todoist" as const,
  toolName: "create_task",
  userId: "owner",
};

describe("connector final effect authority", () => {
  beforeEach(() => {
    state.credentialRead.mockReset().mockResolvedValue();
    state.scopes = "data:read_write";
    state.status = "connected";
    state.providerAccountId = "account-owned";
    state.transactionActive = false;
    state.query.mockReset().mockImplementation(async (query, parameters) => {
      if (
        !parameters.includes(operation.connectionId) ||
        !parameters.includes(operation.userId) ||
        (query.includes('"providerAccountId" =') &&
          !parameters.includes(state.providerAccountId))
      ) {
        return { rows: [] };
      }
      if (query.includes('"accessTokenExpiresAt"')) {
        const provider = [
          "notion",
          "clickup",
          "todoist",
          "microsoft_calendar",
        ].find((candidate) => parameters.includes(candidate));
        const row = [
          new Date(Date.now() + 3_600_000),
          "fixture-access",
          null,
          operation.connectionId,
          provider,
          state.scopes,
          state.status,
        ];
        await state.credentialRead();
        return { rows: [row] };
      }
      if (query.includes('"accountEmail"')) {
        return {
          rows: [
            [
              "owner@example.test",
              operation.connectionId,
              "Owner",
              state.providerAccountId,
              null,
            ],
          ],
        };
      }
      return { rows: [[state.scopes, state.status]] };
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  test.each(["disconnect", "scope-revocation", "account-replacement"])(
    "rejects %s while credentials are loading before a provider write",
    async (change) => {
      const started = Promise.withResolvers<boolean>();
      const release = Promise.withResolvers<boolean>();
      state.credentialRead.mockImplementation(async () => {
        started.resolve(true);
        await release.promise;
      });
      const request = vi.fn<typeof fetch>();
      vi.stubGlobal("fetch", request);
      const result = callRegisteredConnectorTool(operation);
      await started.promise;
      state.status = change === "disconnect" ? "needs_reconnect" : "connected";
      state.scopes = change === "scope-revocation" ? "" : "data:read_write";
      state.providerAccountId =
        change === "account-replacement" ? "account-other" : "account-owned";
      release.resolve(true);
      await expect(result).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(request).not.toHaveBeenCalled();
    }
  );

  test.each([
    operation,
    {
      ...operation,
      arguments: { listId: "list-owned", name: "Review request" },
      provider: "clickup" as const,
    },
    {
      ...operation,
      arguments: {
        parentPageId: "9364d0c9-56a2-4fe9-9816-94ab966885a1",
        title: "Review request",
      },
      provider: "notion" as const,
      toolName: "notion_create_page",
    },
  ])(
    "rechecks authority after $provider credential preparation",
    async (selectedOperation) => {
      const started = Promise.withResolvers<boolean>();
      const release = Promise.withResolvers<boolean>();
      let paused = false;
      state.credentialRead.mockImplementation(async () => {
        started.resolve(true);
        await release.promise;
      });
      const request = vi.fn<typeof fetch>();
      vi.stubGlobal("fetch", request);
      const result = callRegisteredConnectorTool({
        ...selectedOperation,
        beforeEffect: async () => {
          if (paused) {
            throw new ORPCError("FORBIDDEN");
          }
        },
      });
      await started.promise;
      paused = true;
      release.resolve(true);
      await expect(result).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(request).not.toHaveBeenCalled();
    }
  );

  test.each(["disconnect", "account-replacement"])(
    "rejects %s while the caller prepares final authority",
    async (change) => {
      const started = Promise.withResolvers<boolean>();
      const release = Promise.withResolvers<boolean>();
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ content: "Review request", id: "created-task" })
        );
      vi.stubGlobal("fetch", request);
      const result = callRegisteredConnectorTool({
        ...operation,
        prepareEffect: async () => {
          started.resolve(true);
          await release.promise;
        },
      });
      await started.promise;
      state.status = change === "disconnect" ? "needs_reconnect" : "connected";
      state.providerAccountId =
        change === "account-replacement" ? "account-other" : "account-owned";
      release.resolve(true);
      await expect(result).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(request).not.toHaveBeenCalled();
    }
  );

  test("an allowed write uses the transaction's connection for final account access", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ content: "Review request", id: "created-task" })
      );
    vi.stubGlobal("fetch", request);
    await expect(
      callRegisteredConnectorTool({
        ...operation,
        beforeEffect: async (database) => {
          if (database === undefined) {
            throw new Error("Final authority needs its transaction reader.");
          }
          await assertConnectorWriteAccess(
            {
              connectionId: operation.connectionId,
              provider: operation.provider,
              providerAccountId: state.providerAccountId,
              userId: operation.userId,
            },
            database
          );
        },
        prepareEffect: async () => {
          await getConnectorConnectionForUser(operation);
        },
      })
    ).resolves.toMatchObject({
      id: "created-task",
    });
    expect(request).toHaveBeenCalledOnce();
  });

  test("Microsoft account disconnect during the final permission read prevents dispatch", async () => {
    const started = Promise.withResolvers<boolean>();
    const release = Promise.withResolvers<boolean>();
    let initialReadComplete = false;
    state.scopes = "User.Read Calendars.ReadWrite";
    const request = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (initialReadComplete) {
        started.resolve(true);
        await release.promise;
      }
      initialReadComplete = true;
      return Response.json({
        canEdit: true,
        id: "calendar-owned",
        name: "Calendar",
      });
    });
    vi.stubGlobal("fetch", request);
    const result = createMicrosoftCalendarEventForUser({
      calendarId: "calendar-owned",
      connectionId: operation.connectionId,
      event: calendarEventDraftSchema.parse({
        time: {
          endDate: "2026-11-18",
          kind: "all-day",
          startDate: "2026-11-17",
        },
        title: "Planning",
      }),
      operationId: "3d9971cf-eab2-4546-a2c9-22cc926be69d",
      userId: operation.userId,
    });
    await started.promise;
    state.status = "needs_reconnect";
    release.resolve(true);
    await expect(result).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      request.mock.calls.some(([, init]) => init?.method !== undefined)
    ).toBeFalsy();
  });

  test("a registered POST search stays a read under a blocked write guard", async () => {
    const beforeEffect = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new ORPCError("FORBIDDEN"));
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json({ has_more: false, next_cursor: null, results: [] })
      );
    vi.stubGlobal("fetch", request);
    await expect(
      callRegisteredConnectorTool({
        ...operation,
        arguments: { query: "Planning" },
        beforeEffect,
        effect: "read",
        provider: "notion",
        toolName: "notion_search",
      })
    ).resolves.toMatchObject({ results: [] });
    expect(request).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "POST" })
    );
    expect(beforeEffect).not.toHaveBeenCalled();
  });
});
