import { ORPCError } from "@orpc/server";
import type * as DatabaseClientModule from "@quieter/database/client";
import {
  calendarBookingLink,
  calendarBookingReservation,
} from "@quieter/database/schema";
import { getTableColumns } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { assertCalendarBookingAccountBindings } from "../src/calendar/booking-access";
import type { resolveCalendarBookingScopeForUser } from "../src/calendar/booking-access";
import { calendarBookingScopeSchema } from "../src/calendar/booking-contracts";
import { calendarBookingReservationSchema } from "../src/calendar/booking-reservations";
import {
  recordCalendarBooking,
  releaseCalendarBooking,
  reserveCalendarBooking,
} from "../src/calendar/bookings";

const mocks = vi.hoisted(() => ({
  query:
    vi.fn<
      (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
  report: vi.fn<(error: unknown, metadata: unknown) => void>(),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The fixture substitutes the SQL proxy transport for the native driver.
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const database = drizzle(mocks.query);
  Object.defineProperty(database, "transaction", {
    value: async <Result>(
      run: (tx: typeof database) => Promise<Result>
    ): Promise<Result> => await run(database),
  });
  return { ...actual, db: database };
});
vi.mock(import("../src/calendar/booking-access"), () => ({
  assertCalendarBookingAccountBindings:
    vi.fn<typeof assertCalendarBookingAccountBindings>(),
  resolveCalendarBookingScopeForUser:
    vi.fn<typeof resolveCalendarBookingScopeForUser>(),
}));
vi.mock(import("@quieter/observability"), () => ({
  reportError: mocks.report,
}));

type BookingLink = typeof calendarBookingLink.$inferSelect;
type ReservationRow = typeof calendarBookingReservation.$inferSelect;
type Claim = Extract<
  Awaited<ReturnType<typeof reserveCalendarBooking>>,
  { kind: "reserved" }
>["claim"];
const now = new Date("2027-03-29T08:00:00Z");
const scope = calendarBookingScopeSchema.parse({
  accountBindings: [
    {
      connectionId: "private-credential",
      provider: "microsoft_calendar",
      providerAccountId: "private-provider-account",
    },
  ],
  availability: {
    calendars: [
      { calendarId: "private-calendar", connectionId: "private-credential" },
    ],
    end: "2027-03-29T12:00:00Z",
    preferences: {
      bufferAfterMinutes: 10,
      bufferBeforeMinutes: 5,
      durationMinutes: 30,
      stepMinutes: 15,
      workingHours: [{ endMinute: 720, startMinute: 540, weekday: 1 }],
    },
    start: "2027-03-29T09:00:00Z",
    timeZone: "UTC",
  },
  destination: {
    calendarId: "private-calendar",
    connectionId: "private-credential",
  },
  version: 1,
});
const link = {
  createdAt: new Date("2027-03-28T08:00:00Z"),
  expiresAt: new Date("2027-03-29T09:00:00Z"),
  id: "private-link",
  revokedAt: null,
  scope,
  title: "Planning",
  tokenHash: "a".repeat(64),
  updatedAt: new Date("2027-03-28T08:00:00Z"),
  userId: "private-owner",
} satisfies BookingLink;
const request = {
  guest: { email: " Alex@Example.test ", name: " Alex Guest ", note: "  " },
  linkId: link.id,
  requestId: "e0ea95e7-2fa7-4ba2-9a42-6fb9a3c2cb51",
  start: "2027-03-29T11:00:00+02:00",
  userId: link.userId,
};
const fixture: {
  activeCount: number;
  link: BookingLink | null;
  missingInsertReceipt: boolean;
  missingUpdateReceipt: boolean;
  now: Date;
  overlap: boolean;
  reservation: ReservationRow | null;
  totalCount: number;
} = {
  activeCount: 0,
  link,
  missingInsertReceipt: false,
  missingUpdateReceipt: false,
  now,
  overlap: false,
  reservation: null,
  totalCount: 0,
};
const timestampColumns = new Set([
  "busyEnd",
  "busyStart",
  "confirmedAt",
  "createdAt",
  "effectStartedAt",
  "end",
  "leaseUntil",
  "start",
  "updatedAt",
]);

const toSqlRow = (
  row: BookingLink | ReservationRow,
  table: typeof calendarBookingLink | typeof calendarBookingReservation
) => {
  const values = new Map<string, unknown>(Object.entries(row));
  return Object.keys(getTableColumns(table)).map((name) => values.get(name));
};

const readWriteFields = (query: string, params: unknown[]) => {
  const columns = /\((?<columns>[^)]+)\) values/u.exec(query)?.groups?.columns;
  const fields = columns
    ? columns.split(", ").map((column, index) => ({
        name: column.slice(1, -1),
        value: params[index],
      }))
    : query
        .slice(query.indexOf(" set ") + 5, query.indexOf(" where "))
        .split(", ")
        .map((assignment) => {
          const [column, parameter] = assignment.split(" = ");
          return {
            name: column.slice(1, -1),
            value: params[Number(parameter.slice(1)) - 1],
          };
        });
  return Object.fromEntries(
    fields.map(({ name, value }) => [
      name,
      timestampColumns.has(name) && typeof value === "string"
        ? new Date(value)
        : value,
    ])
  );
};

const reserveClaim = async (): Promise<Claim> => {
  const admission = await reserveCalendarBooking(request);
  expect(admission.kind).toBe("reserved");
  if (admission.kind !== "reserved") {
    throw new Error("The fixture reservation was not admitted.");
  }
  return admission.claim;
};

const readReservation = () => {
  if (fixture.reservation === null) {
    throw new Error("The fixture reservation is missing.");
  }
  return calendarBookingReservationSchema.parse(fixture.reservation);
};

describe("booking reservation SQL preparation", () => {
  beforeEach(() => {
    fixture.activeCount = 0;
    fixture.link = link;
    fixture.missingInsertReceipt = false;
    fixture.missingUpdateReceipt = false;
    fixture.now = now;
    fixture.overlap = false;
    fixture.reservation = null;
    fixture.totalCount = 0;
    vi.clearAllMocks();
    vi.mocked(assertCalendarBookingAccountBindings).mockResolvedValue();
    // oxlint-disable-next-line eslint/require-await -- The fixture implements the asynchronous SQL transport, without native transactions or locks.
    mocks.query.mockImplementation(async (query, params) => {
      if (query.includes("pg_advisory_xact_lock")) {
        return { rows: [] };
      }
      if (query.includes('from "user"')) {
        return { rows: params.includes(link.userId) ? [[link.userId]] : [] };
      }
      if (query.includes("clock_timestamp()")) {
        return { rows: [[fixture.now.toISOString()]] };
      }
      if (query.includes('from "calendarBookingLink"')) {
        return {
          rows:
            fixture.link &&
            params.includes(fixture.link.userId) &&
            params.includes(fixture.link.id)
              ? [toSqlRow(fixture.link, calendarBookingLink)]
              : [],
        };
      }
      if (query.startsWith('insert into "calendarBookingReservation"')) {
        fixture.reservation = calendarBookingReservationSchema.parse(
          readWriteFields(query, params)
        );
        return {
          rows: fixture.missingInsertReceipt
            ? []
            : [toSqlRow(fixture.reservation, calendarBookingReservation)],
        };
      }
      if (query.startsWith('update "calendarBookingReservation"')) {
        fixture.reservation = calendarBookingReservationSchema.parse({
          ...fixture.reservation,
          ...readWriteFields(query, params),
        });
        return {
          rows: fixture.missingUpdateReceipt
            ? []
            : [toSqlRow(fixture.reservation, calendarBookingReservation)],
        };
      }
      if (query.includes('from "calendarBookingReservation"')) {
        if (query.startsWith("select count(")) {
          return {
            rows: [
              [
                query.includes('"busyEnd" >')
                  ? fixture.activeCount
                  : fixture.totalCount,
              ],
            ],
          };
        }
        if (query.startsWith('select "id"')) {
          return {
            rows: fixture.overlap ? [["other-owner-link-reservation"]] : [],
          };
        }
        const row = fixture.reservation;
        return {
          rows:
            row &&
            params.includes(row.userId) &&
            params.includes(row.linkId) &&
            (params.includes(row.requestId) || params.includes(row.id))
              ? [toSqlRow(row, calendarBookingReservation)]
              : [],
        };
      }
      throw new Error("Unexpected fixture query.");
    });
  });

  test("returns canonical transient intent and recognizes equivalent retry spellings", async () => {
    const admitted = await reserveCalendarBooking(request);
    expect(admitted).toMatchObject({
      intent: {
        guest: { email: "Alex@Example.test", name: "Alex Guest" },
        slot: {
          end: "2027-03-29T09:30:00.000Z",
          start: "2027-03-29T09:00:00.000Z",
        },
      },
      kind: "reserved",
    });
    expect(JSON.stringify(admitted)).not.toContain('"note"');
    const original = readReservation();
    await expect(
      reserveCalendarBooking({
        ...request,
        guest: { email: "Alex@Example.test", name: "Alex Guest" },
        start: "2027-03-29T09:00:00Z",
      })
    ).resolves.toMatchObject({ kind: "pending" });
    expect(readReservation().id).toBe(original.id);
    const stored = mocks.query.mock.calls.filter(([query]) =>
      query.startsWith('insert into "calendarBookingReservation"')
    );
    expect(JSON.stringify(stored)).not.toMatch(/Alex|Example\.test|Guest/u);
  });

  test("refuses changed intent without replacing an accepted confirmed receipt", async () => {
    const claim = await reserveClaim();
    fixture.reservation = {
      ...readReservation(),
      confirmedAt: now,
      effectStartedAt: now,
      eventId: "accepted-event",
      leaseToken: null,
      leaseUntil: null,
      status: "confirmed",
    };
    fixture.link = { ...link, expiresAt: now, revokedAt: now };
    fixture.activeCount = Number.MAX_SAFE_INTEGER;
    fixture.totalCount = Number.MAX_SAFE_INTEGER;
    vi.mocked(assertCalendarBookingAccountBindings).mockRejectedValue(
      new ORPCError("FORBIDDEN")
    );
    await expect(reserveCalendarBooking(request)).resolves.toMatchObject({
      kind: "confirmed",
    });
    await expect(
      reserveCalendarBooking({
        ...request,
        guest: { ...request.guest, email: "alex@example.test" },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(readReservation()).toMatchObject({
      eventId: "accepted-event",
      id: claim.id,
      status: "confirmed",
    });
  });

  test.each([
    "2027-03-29T08:45:00Z",
    "2027-03-29T11:45:00Z",
    "2027-03-29T09:07:00Z",
  ])(
    "refuses a slot outside the immutable horizon or grid, %s",
    async (start) => {
      await expect(
        reserveCalendarBooking({ ...request, start })
      ).resolves.toMatchObject({ kind: "unavailable" });
      expect(fixture.reservation).toBeNull();
    }
  );

  test("uses a fresh clock after current binding checks", async () => {
    vi.mocked(assertCalendarBookingAccountBindings).mockImplementation(
      async () => {
        fixture.now = link.expiresAt;
        await Promise.resolve();
      }
    );
    await expect(reserveCalendarBooking(request)).resolves.toMatchObject({
      kind: "unavailable",
    });
    expect(fixture.reservation).toBeNull();
  });

  test("emits an owner-wide half-open buffered overlap query and refuses a returned hold", async () => {
    fixture.overlap = true;
    await expect(reserveCalendarBooking(request)).resolves.toMatchObject({
      kind: "unavailable",
    });
    const overlap = mocks.query.mock.calls.find(([query]) =>
      query.startsWith('select "id" from "calendarBookingReservation"')
    );
    expect(overlap?.[0]).toMatch(/"busyStart" < \$/u);
    expect(overlap?.[0]).toMatch(/"busyEnd" > \$/u);
    expect(overlap?.[0]).not.toContain('"linkId"');
    expect(overlap?.[1]).toContain(link.userId);
    expect(overlap?.[1]).toContain("2027-03-29T08:55:00.000Z");
    expect(overlap?.[1]).toContain("2027-03-29T09:40:00.000Z");
    expect(fixture.reservation).toBeNull();
  });

  test("takeover preserves intent and row identity while replacing the lease at insert capacity", async () => {
    const original = await reserveClaim();
    const originalRow = readReservation();
    fixture.now = original.leaseUntil;
    fixture.totalCount = Number.MAX_SAFE_INTEGER;
    const replacement = await reserveClaim();
    expect(replacement.id).toBe(original.id);
    expect(replacement.leaseToken).not.toBe(original.leaseToken);
    expect(readReservation()).toMatchObject({
      createdAt: originalRow.createdAt,
      requestHash: originalRow.requestHash,
      start: originalRow.start,
    });
    await expect(
      releaseCalendarBooking({ claim: original, disposition: "failed" })
    ).resolves.toMatchObject({ kind: "pending" });
    expect(readReservation().leaseToken).toBe(replacement.leaseToken);
    await expect(
      releaseCalendarBooking({ claim: replacement, disposition: "cancelled" })
    ).resolves.toMatchObject({ kind: "unavailable" });
    expect(readReservation().status).toBe("cancelled");
  });

  test("expired takeover still requires active hold capacity", async () => {
    const claim = await reserveClaim();
    fixture.now = claim.leaseUntil;
    fixture.activeCount = Number.MAX_SAFE_INTEGER;
    await expect(reserveCalendarBooking(request)).resolves.toMatchObject({
      kind: "unavailable",
    });
    expect(readReservation().leaseToken).toBe(claim.leaseToken);
  });

  test.each(["activeCount", "totalCount"] as const)(
    "refuses new insertion when %s has no capacity",
    async (quota) => {
      fixture[quota] = Number.MAX_SAFE_INTEGER;
      await expect(reserveCalendarBooking(request)).resolves.toMatchObject({
        kind: "unavailable",
      });
      expect(fixture.reservation).toBeNull();
    }
  );

  test("does not take over inconsistent persisted slot evidence", async () => {
    const claim = await reserveClaim();
    fixture.now = claim.leaseUntil;
    fixture.reservation = {
      ...readReservation(),
      busyEnd: new Date("2027-03-29T09:55:00Z"),
      end: new Date("2027-03-29T09:45:00Z"),
    };
    await expect(reserveCalendarBooking(request)).resolves.toMatchObject({
      kind: "pending",
    });
    expect(readReservation().leaseToken).toBe(claim.leaseToken);
  });

  test("does not record an effect for a merely reserved claim", async () => {
    const claim = await reserveClaim();
    await expect(
      recordCalendarBooking({
        outcome: { eventId: "event", kind: "confirmed" },
        reservation: claim,
      })
    ).resolves.toMatchObject({ kind: "pending" });
    expect(readReservation().status).toBe("reserved");
  });

  test("retains uncertain identity, permits later confirmation, and preserves the receipt after access loss", async () => {
    const claim = await reserveClaim();
    fixture.reservation = {
      ...readReservation(),
      effectStartedAt: now,
      leaseToken: null,
      leaseUntil: null,
      status: "creating",
    };
    await expect(
      recordCalendarBooking({
        outcome: { eventId: "known-event", kind: "uncertain" },
        reservation: claim,
      })
    ).resolves.toMatchObject({ kind: "pending" });
    await recordCalendarBooking({
      outcome: { eventId: null, kind: "uncertain" },
      reservation: claim,
    });
    expect(readReservation()).toMatchObject({
      eventId: "known-event",
      status: "uncertain",
    });
    await expect(
      releaseCalendarBooking({ claim, disposition: "failed" })
    ).resolves.toMatchObject({ kind: "pending" });
    fixture.link = { ...link, expiresAt: now, revokedAt: now };
    vi.mocked(assertCalendarBookingAccountBindings).mockRejectedValue(
      new ORPCError("FORBIDDEN")
    );
    await expect(
      recordCalendarBooking({
        outcome: { eventId: "known-event", kind: "confirmed" },
        reservation: claim,
      })
    ).resolves.toMatchObject({ kind: "confirmed" });
    await expect(
      recordCalendarBooking({
        outcome: { eventId: "other-event", kind: "confirmed" },
        reservation: claim,
      })
    ).resolves.toMatchObject({ kind: "pending" });
    await expect(
      recordCalendarBooking({
        outcome: { eventId: null, kind: "uncertain" },
        reservation: claim,
      })
    ).resolves.toMatchObject({ kind: "confirmed" });
    expect(readReservation()).toMatchObject({
      eventId: "known-event",
      status: "confirmed",
    });
  });

  test("missing write receipts and later missing rows preserve uncertainty", async () => {
    fixture.missingInsertReceipt = true;
    await expect(reserveCalendarBooking(request)).resolves.toMatchObject({
      kind: "pending",
    });
    const row = readReservation();
    if (row.status !== "reserved") {
      throw new Error("The fixture did not retain the reserved row.");
    }
    fixture.missingUpdateReceipt = true;
    await expect(
      releaseCalendarBooking({ claim: row, disposition: "cancelled" })
    ).resolves.toMatchObject({ kind: "pending" });
    fixture.reservation = null;
    await expect(
      recordCalendarBooking({
        outcome: { eventId: "event", kind: "confirmed" },
        reservation: row,
      })
    ).resolves.toMatchObject({ kind: "pending" });
  });

  test("a lost confirmation write receipt remains pending until the stored receipt is read", async () => {
    const claim = await reserveClaim();
    fixture.reservation = {
      ...readReservation(),
      effectStartedAt: now,
      leaseToken: null,
      leaseUntil: null,
      status: "creating",
    };
    fixture.missingUpdateReceipt = true;
    await expect(
      recordCalendarBooking({
        outcome: { eventId: "accepted-event", kind: "confirmed" },
        reservation: claim,
      })
    ).resolves.toMatchObject({ kind: "pending" });
    expect(readReservation().status).toBe("confirmed");
    await expect(
      recordCalendarBooking({
        outcome: { eventId: "accepted-event", kind: "confirmed" },
        reservation: claim,
      })
    ).resolves.toMatchObject({ kind: "confirmed" });
  });

  test("preserves an aborted admission without reporting or storing it", async () => {
    const controller = new AbortController();
    const reason = new Error("The guest closed the page.");
    controller.abort(reason);
    await expect(
      reserveCalendarBooking({ ...request, signal: controller.signal })
    ).rejects.toBe(reason);
    expect(fixture.reservation).toBeNull();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  test("storage failures report no guest payload or original error cause", async () => {
    mocks.query.mockRejectedValue(
      new Error("private Alex@Example.test SQL payload")
    );
    await expect(reserveCalendarBooking(request)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(mocks.report.mock.calls.length).toBeGreaterThan(0);
    for (const [error, metadata] of mocks.report.mock.calls) {
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) {
        throw new Error("Unexpected error report.");
      }
      expect(error.message).not.toMatch(/private|Alex|Example/u);
      expect(error.cause).toBeUndefined();
      expect(JSON.stringify(metadata)).not.toContain("private");
    }
  });

  test("expected owner authorization failures do not become error reports", async () => {
    const original = await reserveClaim();
    const foreign = calendarBookingReservationSchema.parse({
      ...readReservation(),
      userId: "another-owner",
    });
    if (foreign.status !== "reserved") {
      throw new Error("The fixture did not retain the reserved claim.");
    }
    await expect(
      releaseCalendarBooking({ claim: foreign, disposition: "cancelled" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      recordCalendarBooking({
        outcome: { eventId: "event", kind: "confirmed" },
        reservation: foreign,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(readReservation().leaseToken).toBe(original.leaseToken);
    expect(mocks.report).not.toHaveBeenCalled();
  });
});
