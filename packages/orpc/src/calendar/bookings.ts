import { createHash, randomBytes, randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { calculateCalendarAvailability } from "@quieter/calendar/availability";
import { db } from "@quieter/database/client";
import type {
  DatabaseExecutor,
  DatabaseTransaction,
} from "@quieter/database/client";
import {
  calendarBookingLink,
  calendarBookingReservation,
  user,
} from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { consumeRateLimit } from "../abuse-protection";
import { proposeCalendarAvailabilityForUser } from "./availability";
import {
  assertCalendarBookingAccountBindings,
  resolveCalendarBookingScopeForUser,
} from "./booking-access";
import {
  calendarBookingBookInputSchema,
  calendarBookingScopeSchema,
} from "./booking-contracts";
import type {
  CalendarBookingBookInput,
  CalendarBookingCreateInput,
  CalendarBookingOwnerLink,
  CalendarBookingOwnerList,
  CalendarBookingOwnerListInput,
  CalendarBookingResult,
  CalendarBookingResultInput,
  CalendarBookingScope,
  CalendarBookingView,
  CalendarBookingViewInput,
} from "./booking-contracts";
import {
  calendarBookingReservationSchema,
  replayCalendarBookingReservation,
  transitionCalendarBookingReservation,
} from "./booking-reservations";
import type {
  CalendarBookingReservation,
  CalendarBookingReservationCommand,
} from "./booking-reservations";

type BookingLink = typeof calendarBookingLink.$inferSelect;
type UserRequest = { signal?: AbortSignal; userId: string };
type Reserved = Extract<CalendarBookingReservation, { status: "reserved" }>;
type ReservationRef = Pick<
  CalendarBookingReservation,
  "id" | "userId" | "linkId"
>;
type BookingClaim = Pick<
  Reserved,
  "id" | "userId" | "linkId" | "leaseToken" | "leaseUntil"
>;
type BookingAdmission =
  | CalendarBookingResult
  | {
      claim: BookingClaim;
      intent: {
        guest: CalendarBookingBookInput["guest"];
        scope: CalendarBookingScope;
        slot: { start: string; end: string };
        title: string;
      };
      kind: "reserved";
    };
const maxBookingHolds = 1000;
const maxBookingRowsPerLink = 1000;
const bookingLeaseMs = 60_000;
const bookingIntentSchema = calendarBookingBookInputSchema.pick({
  guest: true,
  requestId: true,
  start: true,
});
const clockValueSchema = z
  .union([z.date(), z.string().transform((value) => new Date(value))])
  .pipe(z.date());

const readBookingClock = async (executor: DatabaseExecutor) => {
  const [clock] = await executor
    .select({
      now: sql`clock_timestamp()`.mapWith((value: unknown) =>
        clockValueSchema.parse(value)
      ),
    })
    .from(sql`(values (1)) as booking_clock(value)`);
  if (clock === undefined) {
    throw new Error("Booking clock is unavailable.");
  }
  return clock.now;
};

const withBookingOwnerTransaction = async <Result>(input: {
  run: (tx: DatabaseTransaction) => Promise<Result>;
  userId: string;
}): Promise<Result> =>
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["calendar-booking", input.userId])}, 0))`
    );
    const [owner] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, input.userId))
      .for("key share");
    if (owner === undefined) {
      throw new ORPCError("UNAUTHORIZED");
    }
    return await input.run(tx);
  });

const readLockedBookingReservation = async (
  input: {
    linkId: string;
    tx: DatabaseTransaction;
    userId: string;
  } & ({ id: string } | { requestId: string })
) => {
  const [link] = await input.tx
    .select()
    .from(calendarBookingLink)
    .where(
      and(
        eq(calendarBookingLink.userId, input.userId),
        eq(calendarBookingLink.id, input.linkId)
      )
    )
    .for("update");
  const [reservation] = await input.tx
    .select()
    .from(calendarBookingReservation)
    .where(
      and(
        eq(calendarBookingReservation.userId, input.userId),
        eq(calendarBookingReservation.linkId, input.linkId),
        "id" in input
          ? eq(calendarBookingReservation.id, input.id)
          : eq(calendarBookingReservation.requestId, input.requestId)
      )
    )
    .for("update");
  const now = await readBookingClock(input.tx);
  return { link, now, reservation };
};

const saveBookingReservation = async (input: {
  reservation: CalendarBookingReservation;
  tx: DatabaseTransaction;
}) => {
  const { reservation } = input;
  const [saved] = await input.tx
    .update(calendarBookingReservation)
    .set({
      confirmedAt: reservation.confirmedAt,
      effectStartedAt: reservation.effectStartedAt,
      eventId: reservation.eventId,
      leaseToken: reservation.leaseToken,
      leaseUntil: reservation.leaseUntil,
      status: reservation.status,
      updatedAt: reservation.updatedAt,
    })
    .where(
      and(
        eq(calendarBookingReservation.id, reservation.id),
        eq(calendarBookingReservation.userId, reservation.userId),
        eq(calendarBookingReservation.linkId, reservation.linkId)
      )
    )
    .returning();
  return saved === undefined
    ? null
    : calendarBookingReservationSchema.parse(saved);
};

const toBookingReservationResult = (input: {
  link: BookingLink;
  reservation: CalendarBookingReservation;
}): CalendarBookingResult => {
  switch (input.reservation.status) {
    case "confirmed": {
      const scope = calendarBookingScopeSchema.parse(input.link.scope);
      return {
        kind: "confirmed",
        slot: {
          end: input.reservation.end.toISOString(),
          start: input.reservation.start.toISOString(),
        },
        timeZone: scope.availability.timeZone,
        title: input.link.title,
      };
    }
    case "reserved":
    case "creating":
    case "uncertain": {
      return { kind: "pending" };
    }
    case "failed":
    case "cancelled": {
      return { kind: "unavailable" };
    }
    default: {
      const exhaustive: never = input.reservation;
      return exhaustive;
    }
  }
};

const toOwnerBookingLink = (
  link: BookingLink,
  now: Date
): CalendarBookingOwnerLink => {
  let status: CalendarBookingOwnerLink["status"] =
    link.expiresAt <= now ? "expired" : "active";
  if (link.revokedAt !== null) {
    status = "revoked";
  }
  return {
    createdAt: link.createdAt.toISOString(),
    expiresAt: link.expiresAt.toISOString(),
    id: link.id,
    revokedAt: link.revokedAt?.toISOString() ?? null,
    status,
    title: link.title,
  };
};

export const createCalendarBookingLinkForUser = async (
  input: CalendarBookingCreateInput & UserRequest
) => {
  input.signal?.throwIfAborted();
  const budget = await consumeRateLimit({
    key: `calendar-booking:create:${input.userId}`,
    limit: 30,
    windowMs: 60 * 60_000,
  });
  if (!budget.allowed) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message: "Too many booking links were created. Try again later.",
    });
  }
  const scope = await resolveCalendarBookingScopeForUser(input);
  const capability = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(capability).digest("hex");
  return await withBookingOwnerTransaction({
    run: async (tx) => {
      await assertCalendarBookingAccountBindings({
        executor: tx,
        scope,
        userId: input.userId,
      });
      const now = await readBookingClock(tx);
      input.signal?.throwIfAborted();
      const expiresAt = new Date(input.expiresAt);
      if (expiresAt <= now || new Date(scope.availability.end) <= now) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Choose a future availability range and expiry.",
        });
      }
      const [active] = await tx
        .select({ count: count() })
        .from(calendarBookingLink)
        .where(
          and(
            eq(calendarBookingLink.userId, input.userId),
            isNull(calendarBookingLink.revokedAt),
            gt(calendarBookingLink.expiresAt, now)
          )
        );
      if (active === undefined || active.count >= 20) {
        throw new ORPCError("TOO_MANY_REQUESTS", {
          message: "Revoke an active booking link before creating another.",
        });
      }
      const [link] = await tx
        .insert(calendarBookingLink)
        .values({
          createdAt: now,
          expiresAt,
          id: randomUUID(),
          scope,
          title: input.title,
          tokenHash,
          updatedAt: now,
          userId: input.userId,
        })
        .returning();
      if (link === undefined) {
        throw new Error("Booking link was not saved.");
      }
      return { capability, link: toOwnerBookingLink(link, now) };
    },
    userId: input.userId,
  });
};

export const listCalendarBookingLinksForUser = async (
  input: CalendarBookingOwnerListInput & UserRequest
): Promise<CalendarBookingOwnerList> => {
  input.signal?.throwIfAborted();
  const now = await readBookingClock(db);
  const { after } = input;
  const links = await db
    .select()
    .from(calendarBookingLink)
    .where(
      and(
        eq(calendarBookingLink.userId, input.userId),
        after
          ? or(
              lt(calendarBookingLink.createdAt, new Date(after.createdAt)),
              and(
                eq(calendarBookingLink.createdAt, new Date(after.createdAt)),
                lt(calendarBookingLink.id, after.id)
              )
            )
          : undefined
      )
    )
    .orderBy(desc(calendarBookingLink.createdAt), desc(calendarBookingLink.id))
    .limit(21);
  const page = links.slice(0, 20);
  const last = page.at(-1);
  return {
    links: page.map((link) => toOwnerBookingLink(link, now)),
    ...(links.length > page.length && last
      ? { next: { createdAt: last.createdAt.toISOString(), id: last.id } }
      : {}),
  };
};

export const revokeCalendarBookingLinkForUser = async (
  input: UserRequest & { linkId: string }
): Promise<CalendarBookingOwnerLink> =>
  await withBookingOwnerTransaction({
    run: async (tx) => {
      const [link] = await tx
        .select()
        .from(calendarBookingLink)
        .where(
          and(
            eq(calendarBookingLink.id, input.linkId),
            eq(calendarBookingLink.userId, input.userId)
          )
        )
        .for("update");
      const now = await readBookingClock(tx);
      input.signal?.throwIfAborted();
      if (link === undefined) {
        throw new ORPCError("NOT_FOUND", {
          message: "This booking link is no longer available.",
        });
      }
      if (link.revokedAt !== null) {
        return toOwnerBookingLink(link, now);
      }
      const [revoked] = await tx
        .update(calendarBookingLink)
        .set({ revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(calendarBookingLink.id, input.linkId),
            eq(calendarBookingLink.userId, input.userId)
          )
        )
        .returning();
      if (revoked === undefined) {
        throw new Error("Booking link revocation was not saved.");
      }
      return toOwnerBookingLink(revoked, now);
    },
    userId: input.userId,
  });

export const reserveCalendarBooking = async (
  input: Pick<CalendarBookingBookInput, "guest" | "requestId" | "start"> &
    UserRequest & { linkId: BookingLink["id"] }
): Promise<BookingAdmission> => {
  try {
    input.signal?.throwIfAborted();
    const parsed = bookingIntentSchema.parse({
      guest: input.guest,
      requestId: input.requestId,
      start: input.start,
    });
    const start = new Date(parsed.start);
    const guest: CalendarBookingBookInput["guest"] = {
      ...(parsed.guest.email === undefined
        ? {}
        : { email: parsed.guest.email }),
      name: parsed.guest.name,
      ...(parsed.guest.note ? { note: parsed.guest.note } : {}),
    };
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify([
          1,
          input.userId,
          input.linkId,
          start.toISOString(),
          guest.name,
          guest.email ?? null,
          guest.note ?? null,
        ])
      )
      .digest("hex");
    return await withBookingOwnerTransaction<BookingAdmission>({
      run: async (tx) => {
        const locked = await readLockedBookingReservation({
          linkId: input.linkId,
          requestId: parsed.requestId,
          tx,
          userId: input.userId,
        });
        const { link } = locked;
        if (link === undefined) {
          return { kind: "pending" };
        }
        let takeover: Reserved | null = null;
        if (locked.reservation !== undefined) {
          const replay = replayCalendarBookingReservation({
            now: locked.now,
            requestHash,
            reservation: locked.reservation,
          });
          switch (replay.kind) {
            case "confirmed":
            case "pending": {
              return toBookingReservationResult({
                link,
                reservation: replay.reservation,
              });
            }
            case "unavailable": {
              return { kind: "unavailable" };
            }
            case "refused": {
              if (replay.reason === "request_hash_mismatch") {
                throw new ORPCError("CONFLICT", {
                  message:
                    "This booking request was already submitted with different details.",
                });
              }
              return { kind: "pending" };
            }
            case "takeover": {
              takeover = replay.reservation;
              break;
            }
            default: {
              const exhaustive: never = replay;
              return exhaustive;
            }
          }
        }
        const scope = calendarBookingScopeSchema.parse(link.scope);
        try {
          await assertCalendarBookingAccountBindings({
            executor: tx,
            scope,
            userId: input.userId,
          });
        } catch (error) {
          if (error instanceof ORPCError && error.status < 500) {
            return { kind: "unavailable" };
          }
          throw error;
        }
        const now = await readBookingClock(tx);
        input.signal?.throwIfAborted();
        const { availability } = scope;
        const end = new Date(
          start.getTime() + availability.preferences.durationMinutes * 60_000
        );
        if (
          link.revokedAt !== null ||
          link.expiresAt <= now ||
          start <= now ||
          start < new Date(availability.start) ||
          end > new Date(availability.end)
        ) {
          return { kind: "unavailable" };
        }
        const [candidate] = calculateCalendarAvailability({
          calendars: [],
          input: {
            ...availability,
            end: end.toISOString(),
            limit: 1,
            start: start.toISOString(),
          },
        });
        if (
          candidate === undefined ||
          Date.parse(candidate.start) !== start.getTime() ||
          Date.parse(candidate.end) !== end.getTime()
        ) {
          return { kind: "unavailable" };
        }
        const busyStart = new Date(
          start.getTime() -
            availability.preferences.bufferBeforeMinutes * 60_000
        );
        const busyEnd = new Date(
          end.getTime() + availability.preferences.bufferAfterMinutes * 60_000
        );
        if (
          takeover &&
          (takeover.start.getTime() !== start.getTime() ||
            takeover.end.getTime() !== end.getTime() ||
            takeover.busyStart.getTime() !== busyStart.getTime() ||
            takeover.busyEnd.getTime() !== busyEnd.getTime())
        ) {
          return { kind: "pending" };
        }
        const activeHold = or(
          inArray(calendarBookingReservation.status, [
            "creating",
            "uncertain",
            "confirmed",
          ]),
          and(
            eq(calendarBookingReservation.status, "reserved"),
            gt(calendarBookingReservation.leaseUntil, now)
          )
        );
        const ownerHolds = and(
          eq(calendarBookingReservation.userId, input.userId),
          takeover ? ne(calendarBookingReservation.id, takeover.id) : undefined,
          activeHold
        );
        const [overlap] = await tx
          .select({ id: calendarBookingReservation.id })
          .from(calendarBookingReservation)
          .where(
            and(
              ownerHolds,
              lt(calendarBookingReservation.busyStart, busyEnd),
              gt(calendarBookingReservation.busyEnd, busyStart)
            )
          )
          .limit(1);
        if (overlap !== undefined) {
          return { kind: "unavailable" };
        }
        const [active] = await tx
          .select({ count: count() })
          .from(calendarBookingReservation)
          .where(and(ownerHolds, gt(calendarBookingReservation.busyEnd, now)));
        if (active === undefined) {
          return { kind: "pending" };
        }
        if (active.count >= maxBookingHolds) {
          return { kind: "unavailable" };
        }
        const leaseToken = randomBytes(32).toString("base64url");
        const leaseUntil = new Date(
          Math.min(
            now.getTime() + bookingLeaseMs,
            link.expiresAt.getTime(),
            start.getTime()
          )
        );
        let saved: CalendarBookingReservation | null;
        if (takeover) {
          const changed = transitionCalendarBookingReservation({
            command: { kind: "takeover", leaseToken, leaseUntil },
            now,
            reservation: takeover,
          });
          if (changed.kind !== "changed") {
            return { kind: "pending" };
          }
          saved = await saveBookingReservation({
            reservation: changed.reservation,
            tx,
          });
        } else {
          const [total] = await tx
            .select({ count: count() })
            .from(calendarBookingReservation)
            .where(
              and(
                eq(calendarBookingReservation.userId, input.userId),
                eq(calendarBookingReservation.linkId, input.linkId)
              )
            );
          if (total === undefined) {
            return { kind: "pending" };
          }
          if (total.count >= maxBookingRowsPerLink) {
            return { kind: "unavailable" };
          }
          const reservation = calendarBookingReservationSchema.parse({
            busyEnd,
            busyStart,
            confirmedAt: null,
            createdAt: now,
            effectStartedAt: null,
            end,
            eventId: null,
            id: randomUUID(),
            leaseToken,
            leaseUntil,
            linkId: input.linkId,
            requestHash,
            requestId: parsed.requestId,
            start,
            status: "reserved",
            updatedAt: now,
            userId: input.userId,
          });
          const [inserted] = await tx
            .insert(calendarBookingReservation)
            .values(reservation)
            .onConflictDoNothing({
              target: [
                calendarBookingReservation.linkId,
                calendarBookingReservation.requestId,
              ],
            })
            .returning();
          saved =
            inserted === undefined
              ? null
              : calendarBookingReservationSchema.parse(inserted);
        }
        if (saved === null || saved.status !== "reserved") {
          return { kind: "pending" };
        }
        return {
          claim: {
            id: saved.id,
            leaseToken: saved.leaseToken,
            leaseUntil: saved.leaseUntil,
            linkId: saved.linkId,
            userId: saved.userId,
          },
          intent: {
            guest,
            scope,
            slot: {
              end: saved.end.toISOString(),
              start: saved.start.toISOString(),
            },
            title: link.title,
          },
          kind: "reserved",
        };
      },
      userId: input.userId,
    });
  } catch (error) {
    input.signal?.throwIfAborted();
    if (error instanceof ORPCError && error.status < 500) {
      throw error;
    }
    reportError(new Error("Booking reservation could not be saved."), {
      operation: "calendar:booking-reserve",
    });
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "The booking status could not be checked. Try again.",
    });
  }
};

export const releaseCalendarBooking = async (input: {
  claim: BookingClaim;
  disposition: Extract<
    CalendarBookingReservation,
    { status: "failed" | "cancelled" }
  >["status"];
}): Promise<CalendarBookingResult> => {
  try {
    return await withBookingOwnerTransaction<CalendarBookingResult>({
      run: async (tx) => {
        const locked = await readLockedBookingReservation({
          ...input.claim,
          tx,
        });
        if (locked.link === undefined || locked.reservation === undefined) {
          return { kind: "pending" };
        }
        const reservation = calendarBookingReservationSchema.parse(
          locked.reservation
        );
        const transition = transitionCalendarBookingReservation({
          command: {
            kind: input.disposition === "failed" ? "fail" : "cancel",
            leaseToken: input.claim.leaseToken,
          },
          now: locked.now,
          reservation,
        });
        if (transition.kind === "refused") {
          return toBookingReservationResult({ link: locked.link, reservation });
        }
        const saved = await saveBookingReservation({
          reservation: transition.reservation,
          tx,
        });
        return saved === null
          ? { kind: "pending" }
          : toBookingReservationResult({
              link: locked.link,
              reservation: saved,
            });
      },
      userId: input.claim.userId,
    });
  } catch (error) {
    if (error instanceof ORPCError && error.status < 500) {
      throw error;
    }
    reportError(new Error("Booking reservation could not be released."), {
      operation: "calendar:booking-release",
    });
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "The booking status could not be checked. Try again.",
    });
  }
};

export const recordCalendarBooking = async (input: {
  outcome:
    | {
        eventId: Extract<
          CalendarBookingReservationCommand,
          { kind: "confirm" }
        >["eventId"];
        kind: "confirmed";
      }
    | {
        eventId: Extract<
          CalendarBookingReservationCommand,
          { kind: "mark_uncertain" }
        >["eventId"];
        kind: "uncertain";
      };
  reservation: ReservationRef;
}): Promise<CalendarBookingResult> => {
  try {
    return await withBookingOwnerTransaction<CalendarBookingResult>({
      run: async (tx) => {
        const locked = await readLockedBookingReservation({
          ...input.reservation,
          tx,
        });
        if (locked.link === undefined || locked.reservation === undefined) {
          return { kind: "pending" };
        }
        const reservation = calendarBookingReservationSchema.parse(
          locked.reservation
        );
        const transition = transitionCalendarBookingReservation({
          command:
            input.outcome.kind === "confirmed"
              ? { eventId: input.outcome.eventId, kind: "confirm" }
              : { eventId: input.outcome.eventId, kind: "mark_uncertain" },
          now: locked.now,
          reservation,
        });
        if (transition.kind === "refused") {
          return reservation.status === "confirmed" &&
            transition.reason === "wrong_state"
            ? toBookingReservationResult({ link: locked.link, reservation })
            : { kind: "pending" };
        }
        const saved =
          transition.kind === "unchanged"
            ? transition.reservation
            : await saveBookingReservation({
                reservation: transition.reservation,
                tx,
              });
        return saved === null
          ? { kind: "pending" }
          : toBookingReservationResult({
              link: locked.link,
              reservation: saved,
            });
      },
      userId: input.reservation.userId,
    });
  } catch (error) {
    if (error instanceof ORPCError && error.status < 500) {
      throw error;
    }
    reportError(new Error("Booking outcome could not be saved."), {
      operation: "calendar:booking-record",
    });
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "The booking status could not be checked. Try again.",
    });
  }
};

const resolvePublicBookingLink = async (input: {
  capability: string;
  operation: "view" | "result";
}) => {
  const global = await consumeRateLimit({
    key: "calendar-booking:public",
    limit: 600,
    windowMs: 60_000,
  });
  if (!global.allowed) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message: "Booking requests are temporarily limited. Try again later.",
    });
  }
  const tokenHash = createHash("sha256").update(input.capability).digest("hex");
  const [link] = await db
    .select()
    .from(calendarBookingLink)
    .where(eq(calendarBookingLink.tokenHash, tokenHash))
    .limit(1);
  if (link === undefined) {
    return null;
  }
  const budget = await consumeRateLimit({
    key: `calendar-booking:${input.operation}:${link.id}`,
    limit: input.operation === "view" ? 30 : 60,
    windowMs: 60_000,
  });
  if (!budget.allowed) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message: "Booking requests are temporarily limited. Try again later.",
    });
  }
  return link;
};

export const viewCalendarBooking = async (
  input: CalendarBookingViewInput & { signal?: AbortSignal }
): Promise<CalendarBookingView> => {
  try {
    input.signal?.throwIfAborted();
    const link = await resolvePublicBookingLink({
      ...input,
      operation: "view",
    });
    if (link === null) {
      return { kind: "unavailable" };
    }
    const scope = calendarBookingScopeSchema.safeParse(link.scope);
    if (!scope.success) {
      reportError(new Error("Invalid stored booking scope."), {
        operation: "calendar:booking-view",
      });
      return { kind: "unavailable" };
    }
    await assertCalendarBookingAccountBindings({
      executor: db,
      scope: scope.data,
      userId: link.userId,
    });
    const now = await readBookingClock(db);
    if (link.revokedAt !== null || link.expiresAt <= now) {
      return { kind: "unavailable" };
    }
    const { availability } = scope.data;
    const start = new Date(
      Math.max(
        now.getTime(),
        Date.parse(availability.start),
        input.after ? Date.parse(input.after) + 1 : 0
      )
    );
    const end = new Date(availability.end);
    if (start >= end) {
      return {
        durationMinutes: availability.preferences.durationMinutes,
        kind: "available",
        slots: [],
        timeZone: availability.timeZone,
        title: link.title,
      };
    }
    const buffer =
      Math.max(
        availability.preferences.bufferBeforeMinutes,
        availability.preferences.bufferAfterMinutes
      ) * 60_000;
    const holds = await db
      .select({
        end: calendarBookingReservation.busyEnd,
        start: calendarBookingReservation.busyStart,
      })
      .from(calendarBookingReservation)
      .where(
        and(
          eq(calendarBookingReservation.userId, link.userId),
          lt(
            calendarBookingReservation.busyStart,
            new Date(end.getTime() + buffer)
          ),
          gt(
            calendarBookingReservation.busyEnd,
            new Date(start.getTime() - buffer)
          ),
          or(
            inArray(calendarBookingReservation.status, [
              "creating",
              "uncertain",
              "confirmed",
            ]),
            and(
              eq(calendarBookingReservation.status, "reserved"),
              gt(calendarBookingReservation.leaseUntil, now)
            )
          )
        )
      )
      .limit(maxBookingHolds + 1);
    if (holds.length > maxBookingHolds) {
      return { kind: "unavailable" };
    }
    const result = await proposeCalendarAvailabilityForUser({
      ...availability,
      busyIntervals: holds.map((hold) => ({
        end: hold.end.toISOString(),
        start: hold.start.toISOString(),
      })),
      end: end.toISOString(),
      limit: 21,
      signal: input.signal,
      start: start.toISOString(),
      userId: link.userId,
    });
    if (result.status !== "complete") {
      return { kind: "unavailable" };
    }
    await assertCalendarBookingAccountBindings({
      executor: db,
      scope: scope.data,
      userId: link.userId,
    });
    const [current] = await db
      .select({
        expiresAt: calendarBookingLink.expiresAt,
        revokedAt: calendarBookingLink.revokedAt,
      })
      .from(calendarBookingLink)
      .where(
        and(
          eq(calendarBookingLink.id, link.id),
          eq(calendarBookingLink.userId, link.userId)
        )
      );
    const finishedAt = await readBookingClock(db);
    if (
      current === undefined ||
      current.revokedAt !== null ||
      current.expiresAt <= finishedAt
    ) {
      return { kind: "unavailable" };
    }
    const slots = result.candidates
      .slice(0, 20)
      .map(({ start: slotStart, end: slotEnd }) => ({
        end: slotEnd,
        start: slotStart,
      }));
    const last = slots.at(-1);
    return {
      durationMinutes: availability.preferences.durationMinutes,
      kind: "available",
      ...(result.candidates.length > slots.length && last
        ? { next: last.start }
        : {}),
      slots,
      timeZone: availability.timeZone,
      title: link.title,
    };
  } catch (error) {
    input.signal?.throwIfAborted();
    if (error instanceof ORPCError && error.code === "TOO_MANY_REQUESTS") {
      throw error;
    }
    if (!(error instanceof ORPCError) || error.status >= 500) {
      reportError(new Error("Booking availability could not be loaded."), {
        operation: "calendar:booking-view",
      });
    }
    return { kind: "unavailable" };
  }
};

export const lookupCalendarBookingResult = async (
  input: CalendarBookingResultInput & { signal?: AbortSignal }
): Promise<CalendarBookingResult> => {
  try {
    input.signal?.throwIfAborted();
    const link = await resolvePublicBookingLink({
      ...input,
      operation: "result",
    });
    if (link === null) {
      return { kind: "unavailable" };
    }
    const [row] = await db
      .select()
      .from(calendarBookingReservation)
      .where(
        and(
          eq(calendarBookingReservation.userId, link.userId),
          eq(calendarBookingReservation.linkId, link.id),
          eq(calendarBookingReservation.requestId, input.requestId)
        )
      );
    if (row === undefined) {
      return { kind: "pending" };
    }
    const reservation = calendarBookingReservationSchema.safeParse(row);
    const scope = calendarBookingScopeSchema.safeParse(link.scope);
    if (!reservation.success || !scope.success) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "The booking status could not be checked. Try again.",
      });
    }
    switch (reservation.data.status) {
      case "confirmed": {
        return {
          kind: "confirmed",
          slot: { end: row.end.toISOString(), start: row.start.toISOString() },
          timeZone: scope.data.availability.timeZone,
          title: link.title,
        };
      }
      case "reserved":
      case "creating":
      case "uncertain": {
        return { kind: "pending" };
      }
      case "failed":
      case "cancelled": {
        return { kind: "unavailable" };
      }
      default: {
        const exhaustive: never = reservation.data;
        return exhaustive;
      }
    }
  } catch (error) {
    input.signal?.throwIfAborted();
    if (error instanceof ORPCError && error.code === "TOO_MANY_REQUESTS") {
      throw error;
    }
    if (!(error instanceof ORPCError) || error.status >= 500) {
      reportError(new Error("Booking receipt could not be loaded."), {
        operation: "calendar:booking-result",
      });
    }
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "The booking status could not be checked. Try again.",
    });
  }
};
