import { z } from "zod";

const leaseTokenSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0)
  .brand<"BookingLeaseToken">();
const eventIdSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0)
  .brand<"BookingEventId">();
// A guest-data fingerprint remains private data and must not enter telemetry.
const requestHashSchema = z
  .string()
  .regex(/^[\da-f]{64}$/u)
  .brand<"BookingRequestHash">();
const reservationShape = {
  busyEnd: z.date(),
  busyStart: z.date(),
  createdAt: z.date(),
  end: z.date(),
  id: z.string().min(1).brand<"BookingReservationId">(),
  linkId: z.string().min(1).brand<"BookingLinkId">(),
  requestHash: requestHashSchema,
  requestId: z.uuid({ version: "v4" }).brand<"BookingRequestId">(),
  start: z.date(),
  updatedAt: z.date(),
  userId: z.string().min(1).brand<"BookingOwnerId">(),
};
const preEffectShape = {
  confirmedAt: z.null(),
  effectStartedAt: z.null(),
  eventId: z.null(),
};
const noLeaseShape = { leaseToken: z.null(), leaseUntil: z.null() };
const startedEffectShape = {
  ...noLeaseShape,
  confirmedAt: z.null(),
  effectStartedAt: z.date(),
  eventId: eventIdSchema.nullable(),
};

export const calendarBookingReservationSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      ...reservationShape,
      ...preEffectShape,
      leaseToken: leaseTokenSchema,
      leaseUntil: z.date(),
      status: z.literal("reserved"),
    }),
    z.strictObject({
      ...reservationShape,
      ...startedEffectShape,
      status: z.literal("creating"),
    }),
    z.strictObject({
      ...reservationShape,
      ...startedEffectShape,
      status: z.literal("uncertain"),
    }),
    z.strictObject({
      ...reservationShape,
      ...noLeaseShape,
      confirmedAt: z.date(),
      effectStartedAt: z.date(),
      eventId: eventIdSchema,
      status: z.literal("confirmed"),
    }),
    z.strictObject({
      ...reservationShape,
      ...preEffectShape,
      ...noLeaseShape,
      status: z.literal("failed"),
    }),
    z.strictObject({
      ...reservationShape,
      ...preEffectShape,
      ...noLeaseShape,
      status: z.literal("cancelled"),
    }),
  ])
  .refine(
    (row) =>
      row.busyStart <= row.start &&
      row.start < row.end &&
      row.end <= row.busyEnd,
    "Invalid reservation bounds."
  )
  .refine(
    (row) => row.createdAt <= row.updatedAt,
    "Invalid reservation update order."
  )
  .refine(
    (row) => row.status !== "reserved" || row.updatedAt < row.leaseUntil,
    "Invalid reservation lease order."
  )
  .refine(
    (row) =>
      row.effectStartedAt === null ||
      (row.createdAt <= row.effectStartedAt &&
        row.effectStartedAt <= row.updatedAt),
    "Invalid reservation effect order."
  )
  .refine(
    (row) =>
      row.status !== "confirmed" ||
      (row.effectStartedAt <= row.confirmedAt &&
        row.confirmedAt <= row.updatedAt),
    "Invalid reservation confirmation order."
  );

export type CalendarBookingReservation = z.infer<
  typeof calendarBookingReservationSchema
>;

const replayInputSchema = z.strictObject({
  now: z.date(),
  requestHash: requestHashSchema,
  reservation: calendarBookingReservationSchema,
});
const commandSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("takeover"),
    leaseToken: leaseTokenSchema,
    leaseUntil: z.date(),
  }),
  z.strictObject({ kind: z.literal("start"), leaseToken: leaseTokenSchema }),
  z.strictObject({ kind: z.literal("fail"), leaseToken: leaseTokenSchema }),
  z.strictObject({ kind: z.literal("cancel"), leaseToken: leaseTokenSchema }),
  z.strictObject({
    eventId: eventIdSchema.nullable(),
    kind: z.literal("mark_uncertain"),
  }),
  z.strictObject({ eventId: eventIdSchema, kind: z.literal("confirm") }),
]);
const transitionInputSchema = z.strictObject({
  command: commandSchema,
  now: z.date(),
  reservation: calendarBookingReservationSchema,
});

export type CalendarBookingReservationCommand = z.input<typeof commandSchema>;
export type CalendarBookingReservationReplay =
  | {
      kind: "confirmed";
      reservation: Extract<CalendarBookingReservation, { status: "confirmed" }>;
    }
  | {
      kind: "pending";
      reservation: Extract<
        CalendarBookingReservation,
        { status: "reserved" | "creating" | "uncertain" }
      >;
    }
  | {
      kind: "takeover";
      reservation: Extract<CalendarBookingReservation, { status: "reserved" }>;
    }
  | { kind: "unavailable" }
  | {
      kind: "refused";
      reason: "invalid_input" | "request_hash_mismatch" | "clock_regression";
    };
export type CalendarBookingReservationTransition =
  | {
      kind: "changed";
      reservation: CalendarBookingReservation;
    }
  | {
      kind: "unchanged";
      reservation: CalendarBookingReservation;
    }
  | {
      kind: "refused";
      reason:
        | "invalid_input"
        | "clock_regression"
        | "wrong_state"
        | "lease_active"
        | "lease_expired"
        | "lease_token_mismatch"
        | "lease_token_reused"
        | "invalid_lease_deadline"
        | "event_id_mismatch";
    };

export const replayCalendarBookingReservation = (input: {
  now: Date;
  requestHash: string;
  reservation: unknown;
}): CalendarBookingReservationReplay => {
  const parsed = replayInputSchema.safeParse(input);
  if (!parsed.success) {
    return { kind: "refused", reason: "invalid_input" };
  }
  const { now, requestHash, reservation } = parsed.data;
  if (reservation.requestHash !== requestHash) {
    return { kind: "refused", reason: "request_hash_mismatch" };
  }
  switch (reservation.status) {
    case "confirmed": {
      return { kind: "confirmed", reservation };
    }
    case "creating":
    case "uncertain": {
      return { kind: "pending", reservation };
    }
    case "failed":
    case "cancelled": {
      return { kind: "unavailable" };
    }
    case "reserved": {
      if (now < reservation.updatedAt) {
        return { kind: "refused", reason: "clock_regression" };
      }
      return {
        kind: now < reservation.leaseUntil ? "pending" : "takeover",
        reservation,
      };
    }
    default: {
      const exhaustive: never = reservation;
      return exhaustive;
    }
  }
};

// The caller must supply a fresh database clock after acquiring its locks.
export const transitionCalendarBookingReservation = (input: {
  command: CalendarBookingReservationCommand;
  now: Date;
  reservation: unknown;
}): CalendarBookingReservationTransition => {
  const parsed = transitionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { kind: "refused", reason: "invalid_input" };
  }
  const { command, now, reservation } = parsed.data;
  if (now < reservation.updatedAt) {
    return { kind: "refused", reason: "clock_regression" };
  }
  switch (command.kind) {
    case "takeover": {
      if (reservation.status !== "reserved") {
        return { kind: "refused", reason: "wrong_state" };
      }
      if (now < reservation.leaseUntil) {
        return { kind: "refused", reason: "lease_active" };
      }
      if (command.leaseToken === reservation.leaseToken) {
        return { kind: "refused", reason: "lease_token_reused" };
      }
      if (command.leaseUntil <= now) {
        return { kind: "refused", reason: "invalid_lease_deadline" };
      }
      return {
        kind: "changed",
        reservation: {
          ...reservation,
          leaseToken: command.leaseToken,
          leaseUntil: command.leaseUntil,
          updatedAt: now,
        },
      };
    }
    case "start":
    case "fail":
    case "cancel": {
      if (reservation.status !== "reserved") {
        return { kind: "refused", reason: "wrong_state" };
      }
      if (command.leaseToken !== reservation.leaseToken) {
        return { kind: "refused", reason: "lease_token_mismatch" };
      }
      if (command.kind === "start") {
        if (reservation.leaseUntil <= now) {
          return { kind: "refused", reason: "lease_expired" };
        }
        return {
          kind: "changed",
          reservation: {
            ...reservation,
            effectStartedAt: now,
            leaseToken: null,
            leaseUntil: null,
            status: "creating",
            updatedAt: now,
          },
        };
      }
      return {
        kind: "changed",
        reservation: {
          ...reservation,
          leaseToken: null,
          leaseUntil: null,
          status: command.kind === "fail" ? "failed" : "cancelled",
          updatedAt: now,
        },
      };
    }
    case "mark_uncertain": {
      if (
        reservation.status !== "creating" &&
        reservation.status !== "uncertain"
      ) {
        return { kind: "refused", reason: "wrong_state" };
      }
      if (
        reservation.eventId !== null &&
        command.eventId !== null &&
        reservation.eventId !== command.eventId
      ) {
        return { kind: "refused", reason: "event_id_mismatch" };
      }
      if (
        reservation.status === "uncertain" &&
        (command.eventId === null || command.eventId === reservation.eventId)
      ) {
        return { kind: "unchanged", reservation };
      }
      return {
        kind: "changed",
        reservation: {
          ...reservation,
          eventId: command.eventId ?? reservation.eventId,
          status: "uncertain",
          updatedAt: now,
        },
      };
    }
    case "confirm": {
      if (
        reservation.status !== "creating" &&
        reservation.status !== "uncertain" &&
        reservation.status !== "confirmed"
      ) {
        return { kind: "refused", reason: "wrong_state" };
      }
      if (
        reservation.eventId !== null &&
        reservation.eventId !== command.eventId
      ) {
        return { kind: "refused", reason: "event_id_mismatch" };
      }
      if (reservation.status === "confirmed") {
        return { kind: "unchanged", reservation };
      }
      return {
        kind: "changed",
        reservation: {
          ...reservation,
          confirmedAt: now,
          eventId: command.eventId,
          status: "confirmed",
          updatedAt: now,
        },
      };
    }
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
};
