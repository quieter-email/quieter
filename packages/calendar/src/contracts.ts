import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

export const calendarDateSchema = z.iso.date().refine((value) => {
  try {
    Temporal.PlainDate.from(value, { overflow: "reject" });
    return true;
  } catch {
    return false;
  }
}, "Enter a valid date.");

export const calendarTimeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid time zone.");

const instantSchema = z.iso.datetime({ offset: true });
const identifierSchema = z.string().trim().min(1).max(1024);
export const calendarColorSchema = z
  .string()
  .length(7, "Choose a valid color.")
  .regex(/^#[\da-f]{6}$/iu, "Choose a valid color.");

export const calendarRefSchema = z
  .object({
    calendarId: identifierSchema,
    connectionId: identifierSchema,
  })
  .strict();
export const calendarEventRefSchema = calendarRefSchema.extend({
  eventId: identifierSchema,
});

export const calendarEventTimeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      endDate: calendarDateSchema,
      kind: z.literal("all-day"),
      startDate: calendarDateSchema,
    })
    .strict()
    .refine((value) => value.endDate > value.startDate, {
      message: "The end date must be after the start date.",
      path: ["endDate"],
    }),
  z
    .object({
      end: instantSchema,
      kind: z.literal("timed"),
      start: instantSchema,
      timeZone: calendarTimeZoneSchema,
    })
    .strict()
    .refine((value) => Date.parse(value.end) > Date.parse(value.start), {
      message: "The end time must be after the start time.",
      path: ["end"],
    }),
]);

export const calendarResponseSchema = z.enum([
  "needs-action",
  "accepted",
  "tentative",
  "declined",
]);
const guestSchema = z
  .object({
    email: z.email().max(320),
    name: z.string().max(300).optional(),
    optional: z.boolean().default(false),
  })
  .strict();

export const calendarRemindersSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("default") }).strict(),
  z
    .object({
      items: z
        .array(
          z
            .object({
              method: z.enum(["notification", "email"]),
              minutesBefore: z.number().int().min(0).max(40_320),
            })
            .strict()
        )
        .max(5),
      kind: z.literal("custom"),
    })
    .strict(),
]);
const recurrenceSchema = z
  .array(
    z
      .string()
      .max(2000)
      .regex(
        /^(?:RRULE|RDATE|EXDATE|EXRULE)(?:;[^:\r\n]+)?:[^\r\n]+$/u,
        "Enter a valid recurrence rule."
      )
  )
  .max(20);

export const calendarEventDraftSchema = z
  .object({
    addMeeting: z.boolean().default(false),
    attendees: z.array(guestSchema).max(200).default([]),
    availability: z.enum(["busy", "free"]).default("busy"),
    color: calendarColorSchema.nullable().optional(),
    description: z.string().max(50_000).default(""),
    location: z.string().max(2000).default(""),
    recurrence: recurrenceSchema.default([]),
    reminders: calendarRemindersSchema.default({ kind: "default" }),
    time: calendarEventTimeSchema,
    title: z.string().trim().min(1).max(1000),
    visibility: z.enum(["default", "private", "public"]).default("default"),
  })
  .strict();

export const calendarEventPatchSchema = z
  .object({
    addMeeting: calendarEventDraftSchema.shape.addMeeting.unwrap().optional(),
    attendees: calendarEventDraftSchema.shape.attendees.unwrap().optional(),
    availability: calendarEventDraftSchema.shape.availability
      .unwrap()
      .optional(),
    color: calendarEventDraftSchema.shape.color,
    description: calendarEventDraftSchema.shape.description.unwrap().optional(),
    location: calendarEventDraftSchema.shape.location.unwrap().optional(),
    recurrence: calendarEventDraftSchema.shape.recurrence.unwrap().optional(),
    reminders: calendarEventDraftSchema.shape.reminders.unwrap().optional(),
    time: calendarEventTimeSchema.optional(),
    title: calendarEventDraftSchema.shape.title.optional(),
    visibility: calendarEventDraftSchema.shape.visibility.unwrap().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide a change to save."
  );

const calendarAccountBaseSchema = z.object({
  email: z.string().nullable(),
  id: identifierSchema,
  name: z.string(),
});
export const calendarAccountSchema = z.discriminatedUnion("status", [
  calendarAccountBaseSchema.extend({
    mailboxId: identifierSchema,
    status: z.enum(["connected", "needs-permission", "needs-reconnect"]),
  }),
  calendarAccountBaseSchema.extend({
    mailboxId: z.null(),
    status: z.literal("needs-mailbox"),
  }),
]);

export const calendarSummarySchema = calendarRefSchema.extend({
  access: z.enum(["busy", "read", "write", "owner"]),
  color: calendarColorSchema.optional(),
  name: z.string(),
  primary: z.boolean(),
  selected: z.boolean(),
  supportsMeetings: z.boolean(),
  timeZone: calendarTimeZoneSchema,
});

export const calendarEventSchema = calendarEventRefSchema.extend({
  attendees: z.array(
    guestSchema.extend({
      organizer: z.boolean(),
      response: calendarResponseSchema,
      self: z.boolean(),
    })
  ),
  availability: z.enum(["busy", "free"]),
  color: calendarColorSchema.optional(),
  colorOverride: calendarColorSchema.optional(),
  description: z.string(),
  location: z.string(),
  meetingPending: z.boolean(),
  meetingUrl: z.url().optional(),
  organizer: z
    .object({
      email: z.string().optional(),
      name: z.string().optional(),
      self: z.boolean(),
    })
    .optional(),
  permissions: z.object({
    delete: z.boolean(),
    edit: z.boolean(),
    respond: z.boolean(),
  }),
  recurrence: z.array(z.string()),
  recurringEventId: identifierSchema.optional(),
  reminders: calendarRemindersSchema,
  status: z.enum(["confirmed", "tentative", "cancelled"]),
  time: calendarEventTimeSchema,
  title: z.string(),
  version: z.string().min(1),
  visibility: z.enum(["default", "private", "public"]),
  webUrl: z.url().optional(),
});

export const calendarEventsInputSchema = calendarRefSchema
  .extend({
    end: instantSchema,
    query: z.string().trim().max(500).optional(),
    start: instantSchema,
    timeZone: calendarTimeZoneSchema,
  })
  .refine((value) => {
    const duration = Date.parse(value.end) - Date.parse(value.start);
    return duration > 0 && duration <= 93 * 24 * 60 * 60 * 1000;
  }, "Choose a date range of up to three months.");

export const calendarCreateInputSchema = calendarRefSchema.extend({
  event: calendarEventDraftSchema,
  operationId: z.uuid(),
});
export const calendarUpdateInputSchema = calendarEventRefSchema.extend({
  changes: calendarEventPatchSchema,
  version: z.string().min(1).max(1000),
});
export const calendarUpdateColorInputSchema = calendarRefSchema.extend({
  color: calendarColorSchema,
});
export const calendarDeleteInputSchema = calendarEventRefSchema.extend({
  version: z.string().min(1).max(1000),
});
export const calendarRespondInputSchema = calendarDeleteInputSchema.extend({
  response: calendarResponseSchema.exclude(["needs-action"]),
});

export const calendarMutationResultSchema = calendarEventRefSchema.extend({
  action: z.enum(["created", "updated", "deleted", "responded"]),
  event: calendarEventSchema.optional(),
  status: z.literal("success"),
});

export const calendarViewSchema = z.enum(["day", "week", "month", "agenda"]);
export const calendarWorkspaceSchema = z.object({
  date: calendarDateSchema,
  selectedEvent: calendarEventRefSchema.optional(),
  timeZone: calendarTimeZoneSchema,
  view: calendarViewSchema,
  visibleCalendars: z.array(calendarRefSchema).max(100),
});

export type CalendarRef = z.infer<typeof calendarRefSchema>;
export type CalendarEventRef = z.infer<typeof calendarEventRefSchema>;
export type CalendarAccount = z.infer<typeof calendarAccountSchema>;
export type CalendarSummary = z.infer<typeof calendarSummarySchema>;
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
export type CalendarEventTime = z.infer<typeof calendarEventTimeSchema>;
export type CalendarEventDraft = z.infer<typeof calendarEventDraftSchema>;
export type CalendarEventPatch = z.infer<typeof calendarEventPatchSchema>;
export type CalendarView = z.infer<typeof calendarViewSchema>;
export type CalendarWorkspace = z.infer<typeof calendarWorkspaceSchema>;
export type CalendarMutationResult = z.infer<
  typeof calendarMutationResultSchema
>;
