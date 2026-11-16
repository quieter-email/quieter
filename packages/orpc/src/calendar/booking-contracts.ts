import { calendarRefSchema, calendarTimeZoneSchema } from "@quieter/calendar";
import { calendarAvailabilityInputSchema } from "@quieter/calendar/availability";
import { z } from "zod";

const instantSchema = calendarAvailabilityInputSchema.shape.start.refine(
  (value) => !/\.\d{4}/u.test(value),
  "Choose a time with millisecond precision or less."
);
const titleSchema = z.string().trim().min(1).max(120);
const slotSchema = z
  .object({ end: instantSchema, start: instantSchema })
  .strict()
  .refine((slot) => Date.parse(slot.start) < Date.parse(slot.end), {
    message: "The end time must be after the start time.",
    path: ["end"],
  });
const unavailableSchema = z.object({ kind: z.literal("unavailable") }).strict();

export const calendarBookingCapabilitySchema = z
  .string()
  .regex(/^[\w-]{42}[AEIMQUYcgkosw048]$/u, "Enter a valid booking link.");
export const calendarBookingRequestIdSchema = z.uuid({ version: "v4" });

export const calendarBookingCreateInputSchema = z
  .object({
    availability: calendarAvailabilityInputSchema,
    destination: calendarRefSchema,
    expiresAt: instantSchema,
    title: titleSchema,
  })
  .strict()
  .refine(
    (input) =>
      input.availability.calendars.some(
        (calendar) =>
          calendar.calendarId === input.destination.calendarId &&
          calendar.connectionId === input.destination.connectionId
      ),
    {
      message:
        "Choose a destination from the calendars checked for availability.",
      path: ["destination"],
    }
  )
  .refine(
    (input) =>
      Date.parse(input.expiresAt) <= Date.parse(input.availability.end),
    {
      message: "The booking link must expire within its availability range.",
      path: ["expiresAt"],
    }
  );

export const calendarBookingScopeSchema = z
  .object({
    accountBindings: z
      .array(
        z.discriminatedUnion("provider", [
          z
            .object({
              connectionId: calendarRefSchema.shape.connectionId,
              googleSubject: calendarRefSchema.shape.connectionId,
              mailboxId: calendarRefSchema.shape.connectionId,
              provider: z.literal("google_calendar"),
            })
            .strict(),
          z
            .object({
              connectionId: calendarRefSchema.shape.connectionId,
              provider: z.literal("microsoft_calendar"),
              providerAccountId: calendarRefSchema.shape.connectionId,
            })
            .strict(),
        ])
      )
      .min(1)
      .max(10),
    availability: calendarAvailabilityInputSchema,
    destination: calendarRefSchema,
    version: z.literal(1),
  })
  .strict()
  .refine(
    (scope) =>
      scope.availability.calendars.every(
        (calendar) => calendar.calendarId !== "primary"
      ) && scope.destination.calendarId !== "primary",
    "Store concrete calendars in the booking scope."
  )
  .refine(
    (scope) =>
      scope.availability.calendars.some(
        (calendar) =>
          calendar.calendarId === scope.destination.calendarId &&
          calendar.connectionId === scope.destination.connectionId
      ),
    {
      message:
        "Choose a destination from the calendars checked for availability.",
      path: ["destination"],
    }
  )
  .refine((scope) => {
    const connections = new Set(
      scope.availability.calendars.map((calendar) => calendar.connectionId)
    );
    const bindings = new Set(
      scope.accountBindings.map((binding) => binding.connectionId)
    );
    return (
      bindings.size === scope.accountBindings.length &&
      bindings.size === connections.size &&
      scope.accountBindings.every((binding) =>
        connections.has(binding.connectionId)
      )
    );
  }, "Bind every selected calendar account exactly once.");

export const calendarBookingBookInputSchema = z
  .object({
    capability: calendarBookingCapabilitySchema,
    guest: z
      .object({
        email: z.string().trim().pipe(z.email().max(254)).optional(),
        name: z.string().trim().min(1).max(100),
        note: z.string().trim().max(1000).optional(),
      })
      .strict(),
    requestId: calendarBookingRequestIdSchema,
    start: instantSchema,
  })
  .strict();

export const calendarBookingViewInputSchema = z
  .object({
    after: instantSchema.optional(),
    capability: calendarBookingCapabilitySchema,
  })
  .strict();

export const calendarBookingResultInputSchema = z
  .object({
    capability: calendarBookingCapabilitySchema,
    requestId: calendarBookingRequestIdSchema,
  })
  .strict();

export const calendarBookingViewSchema = z.discriminatedUnion("kind", [
  z
    .object({
      durationMinutes:
        calendarAvailabilityInputSchema.shape.preferences.shape.durationMinutes,
      kind: z.literal("available"),
      next: instantSchema.optional(),
      slots: z.array(slotSchema).max(50),
      timeZone: calendarTimeZoneSchema,
      title: titleSchema,
    })
    .strict()
    .refine(
      (view) =>
        view.slots.every(
          (slot) =>
            Date.parse(slot.end) - Date.parse(slot.start) ===
            view.durationMinutes * 60_000
        ),
      "The available times must match the booking duration."
    ),
  unavailableSchema,
]);

export const calendarBookingResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("confirmed"),
      slot: slotSchema,
      timeZone: calendarTimeZoneSchema,
      title: titleSchema,
    })
    .strict(),
  z.object({ kind: z.literal("pending") }).strict(),
  unavailableSchema,
]);

export type CalendarBookingCapability = z.infer<
  typeof calendarBookingCapabilitySchema
>;
export type CalendarBookingRequestId = z.infer<
  typeof calendarBookingRequestIdSchema
>;
export type CalendarBookingCreateInput = z.infer<
  typeof calendarBookingCreateInputSchema
>;
export type CalendarBookingScope = z.infer<typeof calendarBookingScopeSchema>;
export type CalendarBookingBookInput = z.infer<
  typeof calendarBookingBookInputSchema
>;
export type CalendarBookingViewInput = z.infer<
  typeof calendarBookingViewInputSchema
>;
export type CalendarBookingResultInput = z.infer<
  typeof calendarBookingResultInputSchema
>;
export type CalendarBookingView = z.infer<typeof calendarBookingViewSchema>;
export type CalendarBookingResult = z.infer<typeof calendarBookingResultSchema>;
