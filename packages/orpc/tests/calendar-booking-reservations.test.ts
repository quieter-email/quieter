import { describe, expect, test } from "vite-plus/test";

import {
  calendarBookingReservationSchema,
  replayCalendarBookingReservation,
  transitionCalendarBookingReservation,
} from "../src/calendar/booking-reservations";

const createdAt = new Date("2027-03-29T08:00:00Z");
const leaseUntil = new Date("2027-03-29T08:01:00Z");
const effectStartedAt = new Date("2027-03-29T08:00:30Z");
const confirmedAt = new Date("2027-03-29T08:00:45Z");
const later = new Date("2027-03-30T08:00:00Z");
const reserved = calendarBookingReservationSchema.parse({
  busyEnd: new Date("2027-03-29T10:40:00Z"),
  busyStart: new Date("2027-03-29T09:45:00Z"),
  confirmedAt: null,
  createdAt,
  effectStartedAt: null,
  end: new Date("2027-03-29T10:30:00Z"),
  eventId: null,
  id: "reservation",
  leaseToken: "original-lease",
  leaseUntil,
  linkId: "booking-link",
  requestHash: "a".repeat(64),
  requestId: "e0ea95e7-2fa7-4ba2-9a42-6fb9a3c2cb51",
  start: new Date("2027-03-29T10:00:00Z"),
  status: "reserved",
  updatedAt: createdAt,
  userId: "owner",
});
const creating = calendarBookingReservationSchema.parse({
  ...reserved,
  effectStartedAt,
  leaseToken: null,
  leaseUntil: null,
  status: "creating",
  updatedAt: effectStartedAt,
});
const uncertain = calendarBookingReservationSchema.parse({
  ...creating,
  eventId: "known-event",
  status: "uncertain",
});
const confirmed = calendarBookingReservationSchema.parse({
  ...uncertain,
  confirmedAt,
  status: "confirmed",
  updatedAt: confirmedAt,
});
const failed = calendarBookingReservationSchema.parse({
  ...reserved,
  leaseToken: null,
  leaseUntil: null,
  status: "failed",
});
const cancelled = calendarBookingReservationSchema.parse({
  ...failed,
  status: "cancelled",
});

describe("private reservation row boundary", () => {
  test.each([
    { ...reserved, leaseToken: null },
    { ...reserved, leaseToken: " " },
    { ...reserved, leaseUntil: null },
    { ...reserved, effectStartedAt },
    { ...reserved, eventId: "premature-event" },
    { ...creating, leaseToken: "retained-lease" },
    { ...creating, leaseUntil },
    { ...creating, effectStartedAt: null },
    { ...creating, confirmedAt },
    { ...uncertain, effectStartedAt: null },
    { ...confirmed, eventId: null },
    { ...confirmed, eventId: "" },
    { ...confirmed, eventId: " " },
    { ...confirmed, confirmedAt: null },
    { ...confirmed, leaseToken: "retained-lease" },
    { ...failed, effectStartedAt },
    { ...failed, confirmedAt },
    { ...failed, eventId: "retained-event" },
    { ...cancelled, leaseUntil },
    { ...cancelled, leaseToken: "retained-lease" },
  ])("rejects inconsistent lifecycle evidence", (row) => {
    expect(calendarBookingReservationSchema.safeParse(row).success).toBeFalsy();
  });

  test.each([
    { ...reserved, start: reserved.end },
    { ...reserved, end: reserved.start },
    { ...reserved, busyStart: reserved.end },
    { ...reserved, busyEnd: reserved.start },
    { ...reserved, updatedAt: new Date("2027-03-29T07:59:59Z") },
    { ...reserved, leaseUntil: createdAt },
    { ...creating, effectStartedAt: new Date("2027-03-29T07:59:59Z") },
    { ...creating, effectStartedAt: later },
    { ...confirmed, confirmedAt: createdAt },
    { ...confirmed, confirmedAt: later },
    { ...reserved, start: reserved.start.toISOString() },
    { ...reserved, createdAt: new Date(Number.NaN) },
    { ...reserved, requestId: "e0ea95e7-2fa7-1ba2-9a42-6fb9a3c2cb51" },
    { ...reserved, requestHash: "not-a-sha256-fingerprint" },
    { ...reserved, id: "" },
    { ...reserved, linkId: "" },
    { ...reserved, userId: "" },
    { ...reserved, guest: { name: "unexpected retained guest data" } },
  ])("fails closed on invalid private row values", (row) => {
    expect(calendarBookingReservationSchema.safeParse(row).success).toBeFalsy();
  });
});

describe("reservation replay", () => {
  test.each([reserved, creating, uncertain, confirmed, failed, cancelled])(
    "rejects changed input before considering the status",
    (reservation) => {
      expect(
        replayCalendarBookingReservation({
          now: later,
          requestHash: "b".repeat(64),
          reservation,
        })
      ).toMatchObject({ kind: "refused", reason: "request_hash_mismatch" });
    }
  );

  test("permits takeover at expiry, while an earlier replay remains pending", () => {
    expect(
      replayCalendarBookingReservation({
        now: new Date(leaseUntil.getTime() - 1),
        requestHash: reserved.requestHash,
        reservation: reserved,
      })
    ).toMatchObject({ kind: "pending" });
    expect(
      replayCalendarBookingReservation({
        now: leaseUntil,
        requestHash: reserved.requestHash,
        reservation: reserved,
      })
    ).toMatchObject({ kind: "takeover" });
  });

  test.each([creating, uncertain])(
    "keeps a started effect pending regardless of elapsed time",
    (reservation) => {
      expect(
        replayCalendarBookingReservation({
          now: later,
          requestHash: reservation.requestHash,
          reservation,
        })
      ).toMatchObject({ kind: "pending" });
    }
  );

  test("replays a receipt and preserves pre-effect terminal results", () => {
    expect(
      replayCalendarBookingReservation({
        now: later,
        requestHash: confirmed.requestHash,
        reservation: confirmed,
      })
    ).toMatchObject({
      kind: "confirmed",
      reservation: { eventId: "known-event" },
    });
    for (const reservation of [failed, cancelled]) {
      expect(
        replayCalendarBookingReservation({
          now: later,
          requestHash: reservation.requestHash,
          reservation,
        })
      ).toMatchObject({ kind: "unavailable" });
    }
  });
});

describe("reserved claim fences", () => {
  test("takes over with a fresh token, preserving immutable intent and identity", () => {
    const takeover = transitionCalendarBookingReservation({
      command: {
        kind: "takeover",
        leaseToken: "replacement-lease",
        leaseUntil: new Date("2027-03-29T08:02:00Z"),
      },
      now: leaseUntil,
      reservation: reserved,
    });
    expect(takeover.kind).toBe("changed");
    if (takeover.kind === "refused") {
      throw new Error("The expired reservation could not be taken over.");
    }
    expect(takeover.reservation).toMatchObject({
      busyEnd: reserved.busyEnd,
      busyStart: reserved.busyStart,
      createdAt: reserved.createdAt,
      end: reserved.end,
      id: reserved.id,
      linkId: reserved.linkId,
      requestHash: reserved.requestHash,
      requestId: reserved.requestId,
      start: reserved.start,
      userId: reserved.userId,
    });
    expect(reserved.leaseToken).toBe("original-lease");
    for (const kind of ["start", "fail", "cancel"] satisfies (
      | "start"
      | "fail"
      | "cancel"
    )[]) {
      expect(
        transitionCalendarBookingReservation({
          command: { kind, leaseToken: "original-lease" },
          now: leaseUntil,
          reservation: takeover.reservation,
        })
      ).toMatchObject({ kind: "refused", reason: "lease_token_mismatch" });
    }
    expect(
      transitionCalendarBookingReservation({
        command: { kind: "start", leaseToken: "replacement-lease" },
        now: leaseUntil,
        reservation: takeover.reservation,
      })
    ).toMatchObject({ kind: "changed", reservation: { status: "creating" } });
  });

  test.each([
    {
      leaseToken: "replacement-lease",
      leaseUntil: later,
      now: effectStartedAt,
      reason: "lease_active",
    },
    {
      leaseToken: "original-lease",
      leaseUntil: later,
      now: leaseUntil,
      reason: "lease_token_reused",
    },
    {
      leaseToken: "replacement-lease",
      leaseUntil,
      now: leaseUntil,
      reason: "invalid_lease_deadline",
    },
  ])("refuses unsafe takeover evidence", ({ now, reason, ...lease }) => {
    expect(
      transitionCalendarBookingReservation({
        command: { kind: "takeover", ...lease },
        now,
        reservation: reserved,
      })
    ).toMatchObject({ kind: "refused", reason });
  });

  test("starts only once and clears the pre-effect lease", () => {
    const started = transitionCalendarBookingReservation({
      command: { kind: "start", leaseToken: "original-lease" },
      now: effectStartedAt,
      reservation: reserved,
    });
    expect(started).toMatchObject({
      kind: "changed",
      reservation: {
        confirmedAt: null,
        effectStartedAt,
        eventId: null,
        leaseToken: null,
        leaseUntil: null,
        status: "creating",
      },
    });
    if (started.kind === "refused") {
      throw new Error("The active lease could not start its effect.");
    }
    expect(
      transitionCalendarBookingReservation({
        command: { kind: "start", leaseToken: "original-lease" },
        now: confirmedAt,
        reservation: started.reservation,
      })
    ).toMatchObject({ kind: "refused", reason: "wrong_state" });
    expect(
      transitionCalendarBookingReservation({
        command: { kind: "start", leaseToken: "original-lease" },
        now: leaseUntil,
        reservation: reserved,
      })
    ).toMatchObject({ kind: "refused", reason: "lease_expired" });
  });

  test.each(["fail", "cancel"] satisfies ("fail" | "cancel")[])(
    "ends a matching pre-effect claim through %s",
    (kind) => {
      const result = transitionCalendarBookingReservation({
        command: { kind, leaseToken: "original-lease" },
        now: effectStartedAt,
        reservation: reserved,
      });
      expect(result).toMatchObject({
        kind: "changed",
        reservation: {
          confirmedAt: null,
          effectStartedAt: null,
          eventId: null,
          leaseToken: null,
          leaseUntil: null,
          status: kind === "fail" ? "failed" : "cancelled",
        },
      });
    }
  );
});

describe("started effect retention", () => {
  test.each([creating, uncertain, confirmed, failed, cancelled])(
    "cannot restart, release or take over a claim outside reserved",
    (reservation) => {
      for (const command of [
        { kind: "start", leaseToken: "original-lease" },
        { kind: "fail", leaseToken: "original-lease" },
        { kind: "cancel", leaseToken: "original-lease" },
        {
          kind: "takeover",
          leaseToken: "replacement-lease",
          leaseUntil: later,
        },
      ] satisfies Parameters<
        typeof transitionCalendarBookingReservation
      >[0]["command"][]) {
        expect(
          transitionCalendarBookingReservation({
            command,
            now: later,
            reservation,
          })
        ).toMatchObject({ kind: "refused", reason: "wrong_state" });
      }
    }
  );

  test("retains event evidence on uncertainty and refuses conflicting evidence", () => {
    const result = transitionCalendarBookingReservation({
      command: { eventId: "known-event", kind: "mark_uncertain" },
      now: confirmedAt,
      reservation: creating,
    });
    expect(result).toMatchObject({
      kind: "changed",
      reservation: {
        effectStartedAt,
        eventId: "known-event",
        status: "uncertain",
      },
    });
    expect(
      transitionCalendarBookingReservation({
        command: { eventId: null, kind: "mark_uncertain" },
        now: later,
        reservation: uncertain,
      })
    ).toMatchObject({
      kind: "unchanged",
      reservation: { eventId: "known-event", status: "uncertain" },
    });
    for (const kind of ["mark_uncertain", "confirm"] satisfies (
      | "mark_uncertain"
      | "confirm"
    )[]) {
      expect(
        transitionCalendarBookingReservation({
          command: { eventId: "different-event", kind },
          now: later,
          reservation: uncertain,
        })
      ).toMatchObject({ kind: "refused", reason: "event_id_mismatch" });
    }
  });

  test.each([creating, uncertain])(
    "confirms a started effect with matching or new identity",
    (reservation) => {
      expect(
        transitionCalendarBookingReservation({
          command: { eventId: "known-event", kind: "confirm" },
          now: confirmedAt,
          reservation,
        })
      ).toMatchObject({
        kind: "changed",
        reservation: {
          confirmedAt,
          effectStartedAt,
          eventId: "known-event",
          leaseToken: null,
          leaseUntil: null,
          status: "confirmed",
        },
      });
    }
  );

  test("makes confirmation idempotent without permitting identity replacement or downgrade", () => {
    expect(
      transitionCalendarBookingReservation({
        command: { eventId: "known-event", kind: "confirm" },
        now: later,
        reservation: confirmed,
      })
    ).toMatchObject({
      kind: "unchanged",
      reservation: { confirmedAt, updatedAt: confirmedAt },
    });
    expect(
      transitionCalendarBookingReservation({
        command: { eventId: "different-event", kind: "confirm" },
        now: later,
        reservation: confirmed,
      })
    ).toMatchObject({ kind: "refused", reason: "event_id_mismatch" });
    expect(
      transitionCalendarBookingReservation({
        command: { eventId: "known-event", kind: "mark_uncertain" },
        now: later,
        reservation: confirmed,
      })
    ).toMatchObject({ kind: "refused", reason: "wrong_state" });
  });

  test("rejects a regressed or invalid operation clock", () => {
    for (const now of [createdAt, new Date(Number.NaN)]) {
      expect(
        transitionCalendarBookingReservation({
          command: { eventId: "known-event", kind: "confirm" },
          now,
          reservation: creating,
        })
      ).toMatchObject({ kind: "refused" });
    }
  });

  test("refuses private intent fields smuggled into a command", () => {
    const command = {
      eventId: "known-event",
      kind: "confirm",
      requestHash: "b".repeat(64),
      start: later,
      userId: "different-owner",
    } satisfies { kind: "confirm" } & Record<string, unknown>;
    expect(
      transitionCalendarBookingReservation({
        command,
        now: confirmedAt,
        reservation: creating,
      })
    ).toMatchObject({ kind: "refused", reason: "invalid_input" });
  });
});
