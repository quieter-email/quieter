/* oxlint-disable eslint/require-await -- SQL and HTTP fixtures preserve asynchronous transport contracts. */
import { db } from "@quieter/database/client";
import type * as DatabaseClientModule from "@quieter/database/client";
import type { reportError } from "@quieter/observability";
import { drizzle } from "drizzle-orm/pg-proxy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  assertCalendarBookingAccountBindings,
  resolveCalendarBookingScopeForUser,
} from "../src/calendar/booking-access";
import { calendarBookingCreateInputSchema } from "../src/calendar/booking-contracts";
import { CALENDAR_SCOPES } from "../src/gmail-mailbox-access";

const mocks = vi.hoisted(() => ({
  account: {
    googleScopes: "",
    googleStatus: "connected",
    googleSubject: "google-subject",
    microsoftScopes: "User.Read Calendars.ReadWrite offline_access",
    microsoftStatus: "connected",
    microsoftSubject: "microsoft-subject",
  },
  googleAccess: "owner",
  googlePrimary: true,
  query:
    vi.fn<
      (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
  report: vi.fn<typeof reportError>(),
}));
vi.mock(import("@quieter/observability"), () => ({
  reportError: mocks.report,
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The SQL proxy exercises the existing service's real ownership predicates.
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  const { drizzle: proxyDrizzle } = await import("drizzle-orm/pg-proxy");
  return { ...actual, db: proxyDrizzle(mocks.query) };
});
vi.mock(import("../src/gmail-mailbox-access"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runAuthorizedGmailMailbox: async <T>(
      _input: Parameters<typeof actual.runAuthorizedGmailMailbox>[0],
      run: (token: string) => Promise<T>
    ): Promise<T> => await run("fixture-token"),
  };
});
vi.mock(import("../src/connectors/runtime"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runAuthorizedConnector: async <T>(
      input: Parameters<typeof actual.runAuthorizedConnector>[0],
      run: (token: string, signal?: AbortSignal) => Promise<T>
    ): Promise<T> => await run("fixture-token", input.signal),
  };
});

const google = { calendarId: "primary", connectionId: "legacy-google" };
const microsoft = { calendarId: "primary", connectionId: "native-microsoft" };
const input = calendarBookingCreateInputSchema.parse({
  availability: {
    calendars: [
      google,
      { calendarId: "personal", connectionId: "native-mailbox" },
      { calendarId: "shared", connectionId: "legacy-google" },
      microsoft,
      { calendarId: "work", connectionId: "native-microsoft" },
    ],
    end: "2027-03-29T13:00:00+02:00",
    preferences: {
      bufferAfterMinutes: 10,
      bufferBeforeMinutes: 15,
      durationMinutes: 30,
      stepMinutes: 15,
      workingHours: [{ endMinute: 780, startMinute: 540, weekday: 1 }],
    },
    start: "2027-03-29T09:00:00+02:00",
    timeZone: "Europe/Berlin",
  },
  destination: google,
  expiresAt: "2027-03-29T12:00:00+02:00",
  title: "Office hours",
});

const readFixtureRows = async (query: string, params: unknown[]) => {
  if (!params.includes("owner")) {
    return { rows: [] };
  }
  if (query.includes('from "connectorCredential"')) {
    if (params.includes("google_calendar")) {
      return {
        rows: [["owner@example.com", null, "legacy-google", "google-subject"]],
      };
    }
    if (query.includes('"accountEmail"')) {
      return {
        rows: [
          [
            "owner@example.com",
            null,
            "native-microsoft",
            mocks.account.microsoftScopes,
            mocks.account.microsoftStatus,
          ],
        ],
      };
    }
    return {
      rows: [
        [
          "native-microsoft",
          mocks.account.microsoftSubject,
          mocks.account.microsoftScopes,
          mocks.account.microsoftStatus,
        ],
      ],
    };
  }
  if (query.includes('from "gmailCredential"')) {
    return {
      rows: [
        [
          mocks.account.googleSubject,
          "native-mailbox",
          mocks.account.googleScopes,
        ],
      ],
    };
  }
  if (query.includes('left join "gmailCredential"')) {
    return {
      rows: [
        [
          null,
          "owner@example.com",
          mocks.account.googleSubject,
          "native-mailbox",
          mocks.account.googleScopes,
          mocks.account.googleStatus,
        ],
      ],
    };
  }
  return { rows: [["native-mailbox", mocks.account.googleStatus]] };
};

const respond = (request: Request) => {
  if (request.url.includes("googleapis.com")) {
    return Response.json({
      items: [
        {
          accessRole: mocks.googleAccess,
          backgroundColor: "#000000",
          id: "personal",
          primary: mocks.googlePrimary,
          summary: "Personal",
          timeZone: "UTC",
        },
        {
          accessRole: "reader",
          backgroundColor: "#000000",
          id: "shared",
          timeZone: "UTC",
        },
      ],
    });
  }
  return Response.json({
    value: [
      { canEdit: true, id: "work", isDefaultCalendar: true, name: "Work" },
    ],
  });
};

describe("booking account scope", () => {
  beforeEach(() => {
    mocks.account = {
      googleScopes: CALENDAR_SCOPES.join(" "),
      googleStatus: "connected",
      googleSubject: "google-subject",
      microsoftScopes: "User.Read Calendars.ReadWrite offline_access",
      microsoftStatus: "connected",
      microsoftSubject: "microsoft-subject",
    };
    mocks.googleAccess = "owner";
    mocks.googlePrimary = true;
    mocks.query.mockReset().mockImplementation(readFixtureRows);
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockImplementation(async (url, init) =>
          respond(new Request(url, init))
        )
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  test("normalizes native accounts and calendars, merging only physical aliases", async () => {
    const scope = await resolveCalendarBookingScopeForUser({
      ...input,
      userId: "owner",
    });
    expect(scope.availability.calendars).toStrictEqual([
      { calendarId: "personal", connectionId: "native-mailbox" },
      { calendarId: "shared", connectionId: "native-mailbox" },
      { calendarId: "work", connectionId: "native-microsoft" },
    ]);
    expect(scope.destination).toMatchObject({
      calendarId: "personal",
      connectionId: "native-mailbox",
    });
    expect(scope.accountBindings).toMatchObject([
      {
        connectionId: "native-mailbox",
        googleSubject: "google-subject",
        mailboxId: "native-mailbox",
        provider: "google_calendar",
      },
      {
        connectionId: "native-microsoft",
        provider: "microsoft_calendar",
        providerAccountId: "microsoft-subject",
      },
    ]);
    expect(scope.availability).toMatchObject({
      end: input.availability.end,
      preferences: input.availability.preferences,
      start: input.availability.start,
      timeZone: input.availability.timeZone,
    });
  });

  test("rejects foreign accounts before any provider read", async () => {
    await expect(
      resolveCalendarBookingScopeForUser({ ...input, userId: "foreign-user" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fetch).not.toHaveBeenCalled();
    expect(
      mocks.query.mock.calls.every(([query]) =>
        /"(?:ownerUserId|userId)" =/u.test(query)
      )
    ).toBeTruthy();
  });

  test("permits read-only selected calendars but requires a writable explicit destination", async () => {
    mocks.googleAccess = "reader";
    await expect(
      resolveCalendarBookingScopeForUser({ ...input, userId: "owner" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      resolveCalendarBookingScopeForUser({
        ...input,
        destination: microsoft,
        userId: "owner",
      })
    ).resolves.toMatchObject({
      destination: { calendarId: "work", connectionId: "native-microsoft" },
    });
  });

  test("refuses unresolved primary aliases", async () => {
    mocks.googlePrimary = false;
    await expect(
      resolveCalendarBookingScopeForUser({ ...input, userId: "owner" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test.each([
    { key: "googleSubject", value: "replacement-google-subject" },
    { key: "microsoftSubject", value: "replacement-microsoft-subject" },
  ] satisfies { key: keyof typeof mocks.account; value: string }[])(
    "rejects $key replacement during provider preparation",
    async ({ key, value }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
          mocks.account[key] = value;
          return respond(new Request(url, init));
        })
      );
      await expect(
        resolveCalendarBookingScopeForUser({ ...input, userId: "owner" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  );

  test("rejects incomplete destination selection", async () => {
    await expect(
      resolveCalendarBookingScopeForUser({
        ...input,
        destination: { ...google, calendarId: "unchecked" },
        userId: "owner",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("does not retain private database failures in access errors", async () => {
    mocks.query.mockRejectedValue(new Error("provider-private-record"));
    const resolution = resolveCalendarBookingScopeForUser({
      ...input,
      userId: "owner",
    });
    await expect(resolution).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    await expect(resolution).rejects.not.toHaveProperty("cause");
    await expect(resolution).rejects.not.toThrow(/provider-private-record/u);
    expect(mocks.report.mock.calls.length).toBeGreaterThan(0);
    for (const [error] of mocks.report.mock.calls) {
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) {
        throw new Error("Unexpected report value.");
      }
      expect(error.message).not.toContain("provider-private-record");
      expect(error.cause).toBeUndefined();
    }
  });

  test("uses only the caller executor for locked nonsecret final checks", async () => {
    const scope = await resolveCalendarBookingScopeForUser({
      ...input,
      userId: "owner",
    });
    const query = vi.fn<typeof readFixtureRows>(readFixtureRows);
    const callerDb = drizzle(query);
    const executor = new Proxy(db, {
      get(target, key, receiver): unknown {
        return key === "select"
          ? callerDb.select.bind(callerDb)
          : Reflect.get(target, key, receiver);
      },
    });
    mocks.query.mockRejectedValue(
      new Error("Global executor must not be used.")
    );
    vi.mocked(fetch).mockClear();
    await expect(
      assertCalendarBookingAccountBindings({ executor, scope, userId: "owner" })
    ).resolves.toBeUndefined();
    expect(query.mock.calls.length).toBeGreaterThan(0);
    expect(
      query.mock.calls.every(
        ([sql, params]) => sql.includes("for share") && params.includes("owner")
      )
    ).toBeTruthy();
    expect(query.mock.calls.map(([sql]) => sql).join(" ")).not.toMatch(
      /encrypted|updatedAt|accessToken/iu
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    { key: "googleSubject", value: "replacement" },
    { key: "microsoftSubject", value: "replacement" },
    { key: "googleScopes", value: "" },
    { key: "microsoftScopes", value: "User.Read" },
    { key: "googleStatus", value: "needs_reconnect" },
    { key: "microsoftStatus", value: "needs_reconnect" },
  ] satisfies { key: keyof typeof mocks.account; value: string }[])(
    "fails the final guard after $key changes",
    async ({ key, value }) => {
      const scope = await resolveCalendarBookingScopeForUser({
        ...input,
        userId: "owner",
      });
      mocks.account[key] = value;
      await expect(
        assertCalendarBookingAccountBindings({
          executor: db,
          scope,
          userId: "owner",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  );

  test("checks current ownership again at the final guard", async () => {
    const scope = await resolveCalendarBookingScopeForUser({
      ...input,
      userId: "owner",
    });
    await expect(
      assertCalendarBookingAccountBindings({
        executor: db,
        scope,
        userId: "foreign-user",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
