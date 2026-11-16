import { createHash } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { calculateCalendarAvailability } from "@quieter/calendar/availability";
import type * as DatabaseClientModule from "@quieter/database/client";
import type {
  calendarBookingLink,
  calendarBookingReservation,
} from "@quieter/database/schema";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { consumeRateLimit } from "../src/abuse-protection";
import { proposeCalendarAvailabilityForUser } from "../src/calendar/availability";
import { assertCalendarBookingAccountBindings } from "../src/calendar/booking-access";
import type { resolveCalendarBookingScopeForUser } from "../src/calendar/booking-access";
import { calendarBookingScopeSchema } from "../src/calendar/booking-contracts";
import {
  lookupCalendarBookingResult,
  viewCalendarBooking,
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
  return { ...actual, db: drizzle(mocks.query) };
});
vi.mock(import("../src/abuse-protection"), () => ({
  consumeRateLimit: vi.fn<typeof consumeRateLimit>(),
}));
vi.mock(import("../src/calendar/booking-access"), () => ({
  assertCalendarBookingAccountBindings:
    vi.fn<typeof assertCalendarBookingAccountBindings>(),
  resolveCalendarBookingScopeForUser:
    vi.fn<typeof resolveCalendarBookingScopeForUser>(),
}));
vi.mock(import("../src/calendar/availability"), () => ({
  proposeCalendarAvailabilityForUser:
    vi.fn<typeof proposeCalendarAvailabilityForUser>(),
}));
vi.mock(import("@quieter/observability"), () => ({
  reportError: mocks.report,
}));

const now = new Date("2027-03-29T08:00:00Z");
const capability = Buffer.alloc(32, 7).toString("base64url");
const requestId = "e0ea95e7-2fa7-4ba2-9a42-6fb9a3c2cb51";
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
    end: "2027-03-29T10:00:00Z",
    preferences: {
      bufferAfterMinutes: 10,
      bufferBeforeMinutes: 10,
      durationMinutes: 15,
      stepMinutes: 15,
      workingHours: [{ endMinute: 600, startMinute: 540, weekday: 1 }],
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
type BookingLink = typeof calendarBookingLink.$inferSelect;
type ReservationRow = typeof calendarBookingReservation.$inferSelect;
const link = {
  createdAt: new Date("2027-03-28T08:00:00Z"),
  expiresAt: new Date("2027-03-29T09:00:00Z"),
  id: "private-link",
  revokedAt: null,
  scope,
  title: "Planning",
  tokenHash: createHash("sha256").update(capability).digest("hex"),
  updatedAt: new Date("2027-03-28T08:00:00Z"),
  userId: "private-owner",
} satisfies BookingLink;
const confirmed = {
  busyEnd: new Date("2027-03-29T09:25:00Z"),
  busyStart: new Date("2027-03-29T08:50:00Z"),
  confirmedAt: new Date("2027-03-29T08:00:10Z"),
  createdAt: now,
  effectStartedAt: now,
  end: new Date("2027-03-29T09:15:00Z"),
  eventId: "private-event",
  id: "private-reservation",
  leaseToken: null,
  leaseUntil: null,
  linkId: link.id,
  requestHash: "a".repeat(64),
  requestId,
  start: new Date("2027-03-29T09:00:00Z"),
  status: "confirmed",
  updatedAt: new Date("2027-03-29T08:00:10Z"),
  userId: link.userId,
} satisfies ReservationRow;
const fixture: {
  currentRevokedAt: Date | null;
  holds: { start: Date; end: Date }[];
  link: BookingLink | null;
  receipt: ReservationRow | null;
} = {
  currentRevokedAt: null,
  holds: [],
  link,
  receipt: confirmed,
};

describe("booking read boundaries", () => {
  beforeEach(() => {
    fixture.currentRevokedAt = null;
    fixture.holds = [];
    fixture.link = link;
    fixture.receipt = confirmed;
    vi.clearAllMocks();
    vi.mocked(consumeRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 1,
      resetAt: now,
    });
    vi.mocked(assertCalendarBookingAccountBindings).mockResolvedValue();
    // oxlint-disable-next-line eslint/require-await -- The fixture implements the asynchronous SQL transport contract.
    mocks.query.mockImplementation(async (query, params) => {
      if (query.includes("clock_timestamp()")) {
        return { rows: [[now.toISOString()]] };
      }
      if (query.includes('"calendarBookingLink"')) {
        if (query.includes('"tokenHash" =')) {
          return {
            rows:
              fixture.link && params.includes(fixture.link.tokenHash)
                ? [Object.values(fixture.link)]
                : [],
          };
        }
        return {
          rows: [[link.expiresAt, fixture.currentRevokedAt]],
        };
      }
      if (query.includes('"calendarBookingReservation"')) {
        return params.includes(requestId)
          ? { rows: fixture.receipt ? [Object.values(fixture.receipt)] : [] }
          : { rows: fixture.holds.map((hold) => [hold.end, hold.start]) };
      }
      throw new Error("Unexpected fixture query.");
    });
    vi.mocked(proposeCalendarAvailabilityForUser).mockImplementation(
      // oxlint-disable-next-line eslint/require-await -- The fixture implements the asynchronous availability service contract.
      async (input) => ({
        candidates: calculateCalendarAvailability({
          busyIntervals: input.busyIntervals,
          calendars: input.calendars.map((calendar) => ({
            calendar: {
              ...calendar,
              access: "owner",
              name: "Private calendar",
              primary: true,
              selected: true,
              supportsMeetings: false,
              timeZone: input.timeZone,
            },
            events: [],
          })),
          input,
        }),
        checkedAt: now.toISOString(),
        coverage: input.calendars.map((calendar) => ({
          calendar,
          status: "complete",
        })),
        explanation: "Private coverage details do not leave this service.",
        status: "complete",
        timeZone: input.timeZone,
      })
    );
  });

  describe("scoped booking availability reads", () => {
    test("applies owner holds beyond the unbuffered horizon and projects only public slots", async () => {
      fixture.holds = [
        {
          end: new Date("2027-03-29T10:20:00Z"),
          start: new Date("2027-03-29T10:05:00Z"),
        },
      ];
      const view = await viewCalendarBooking({ capability });
      expect(view.kind).toBe("available");
      if (view.kind !== "available") {
        return;
      }
      expect(view.slots.map((slot) => slot.start)).toContain(
        "2027-03-29T09:30:00Z"
      );
      expect(view.slots.map((slot) => slot.start)).not.toContain(
        "2027-03-29T09:45:00Z"
      );
      expect(JSON.stringify(view)).not.toMatch(/private-|coverage|eventId/u);
      const holdQuery = mocks.query.mock.calls.find(([query]) =>
        query.includes('"busyEnd"')
      );
      expect(holdQuery?.[1]).toContain("2027-03-29T10:10:00.000Z");
      expect(holdQuery?.[1]).toContain("2027-03-29T08:50:00.000Z");
    });

    test("does not publish slots after revocation during the provider read", async () => {
      const calculate = vi
        .mocked(proposeCalendarAvailabilityForUser)
        .getMockImplementation();
      vi.mocked(proposeCalendarAvailabilityForUser).mockImplementation(
        async (input) => {
          fixture.currentRevokedAt = now;
          if (!calculate) {
            throw new Error("Missing fixture calculator.");
          }
          return await calculate(input);
        }
      );
      await expect(viewCalendarBooking({ capability })).resolves.toMatchObject({
        kind: "unavailable",
      });
    });

    test("fails closed when account identity changes during the read", async () => {
      vi.mocked(assertCalendarBookingAccountBindings)
        .mockResolvedValueOnce()
        .mockRejectedValueOnce(new ORPCError("FORBIDDEN"));
      await expect(viewCalendarBooking({ capability })).resolves.toMatchObject({
        kind: "unavailable",
      });
    });

    test("fails closed on incomplete calendar coverage", async () => {
      vi.mocked(proposeCalendarAvailabilityForUser).mockResolvedValue({
        candidates: [],
        checkedAt: now.toISOString(),
        coverage: [
          {
            calendar: scope.destination,
            reason: "permission",
            status: "unavailable",
          },
        ],
        explanation: "Private permission details.",
        status: "unavailable",
        timeZone: "UTC",
      });
      await expect(viewCalendarBooking({ capability })).resolves.toMatchObject({
        kind: "unavailable",
      });
    });

    test("unknown tokens do not allocate token-specific rate buckets", async () => {
      fixture.link = null;
      for (let value = 1; value < 4; value += 1) {
        await viewCalendarBooking({
          capability: Buffer.alloc(32, value).toString("base64url"),
        });
      }
      expect(
        new Set(
          vi.mocked(consumeRateLimit).mock.calls.map(([input]) => input.key)
        ).size
      ).toBe(1);
    });
  });

  describe("booking receipt privacy and uncertainty", () => {
    test("replays a confirmed receipt after link revocation without returning private identity", async () => {
      fixture.link = { ...link, expiresAt: now, revokedAt: now };
      const receipt = await lookupCalendarBookingResult({
        capability,
        requestId,
      });
      expect(receipt).toMatchObject({
        kind: "confirmed",
        slot: { start: confirmed.start.toISOString() },
      });
      expect(JSON.stringify(receipt)).not.toMatch(
        /private-|requestHash|eventId|userId/u
      );
    });

    test("a missing receipt stays pending while a request may still be arriving", async () => {
      fixture.receipt = null;
      await expect(
        lookupCalendarBookingResult({ capability, requestId })
      ).resolves.toMatchObject({ kind: "pending" });
    });

    test("rate limits do not become a definitive unavailable receipt", async () => {
      vi.mocked(consumeRateLimit).mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: now,
      });
      await expect(
        lookupCalendarBookingResult({ capability, requestId })
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
      expect(mocks.query).not.toHaveBeenCalled();
    });

    test("database failures preserve uncertainty and report no private cause", async () => {
      mocks.query.mockRejectedValue(
        new Error("private guest@example.test database payload")
      );
      await expect(
        lookupCalendarBookingResult({ capability, requestId })
      ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
      expect(mocks.report.mock.calls.length).toBeGreaterThan(0);
      for (const [error, metadata] of mocks.report.mock.calls) {
        expect(error).toBeInstanceOf(Error);
        if (!(error instanceof Error)) {
          throw new Error("Unexpected error report.");
        }
        expect(error.message).not.toMatch(/private|guest@example/u);
        expect(error.cause).toBeUndefined();
        expect(JSON.stringify(metadata)).not.toContain(capability);
      }
    });
  });
});
