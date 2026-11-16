import { createHash, randomBytes, randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import type { DatabaseExecutor } from "@quieter/database/client";
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
import { calendarBookingScopeSchema } from "./booking-contracts";
import type {
  CalendarBookingCreateInput,
  CalendarBookingOwnerLink,
  CalendarBookingOwnerList,
  CalendarBookingOwnerListInput,
  CalendarBookingResult,
  CalendarBookingResultInput,
  CalendarBookingView,
  CalendarBookingViewInput,
} from "./booking-contracts";
import { calendarBookingReservationSchema } from "./booking-reservations";

type BookingLink = typeof calendarBookingLink.$inferSelect;
type UserRequest = { signal?: AbortSignal; userId: string };
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
  return await db.transaction(async (tx) => {
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
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["calendar-booking", input.userId])}, 0))`
    );
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
  });

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
      .limit(1001);
    if (holds.length > 1000) {
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
