import ICAL from "ical.js";

export type GoogleCalendarEventDate =
  | {
      date: string;
      dateTime?: never;
      timeZone?: never;
    }
  | {
      date?: never;
      dateTime: string;
      timeZone?: string;
    };

export type GoogleCalendarEventDraft = {
  description?: string;
  end: GoogleCalendarEventDate;
  iCalUID?: string;
  location?: string;
  recurrence?: string[];
  start: GoogleCalendarEventDate;
  summary: string;
};

const toCalendarDate = (
  date: ICAL.Time,
  property: ICAL.Property | null
): GoogleCalendarEventDate => {
  if (date.isDate) {
    return { date: date.toString() };
  }
  const dateTime = date.toString();
  if (dateTime.endsWith("Z")) {
    return { dateTime };
  }
  const timeZone: unknown = property?.getParameter("tzid");
  return {
    dateTime,
    timeZone: typeof timeZone === "string" ? timeZone : "UTC",
  };
};

export const parseIcsToGoogleCalendarEvent = (
  input: string
): GoogleCalendarEventDraft => {
  const calendar = ICAL.Component.fromString(input);
  const component = calendar.getFirstSubcomponent("vevent");
  if (component === null) {
    throw new Error("Calendar invitation does not include an event.");
  }
  const startProperty = component.getFirstProperty("dtstart");
  if (startProperty === null) {
    throw new Error("Calendar invitation does not include a start time.");
  }
  const event = new ICAL.Event(component);
  const endProperty = component.getFirstProperty("dtend");
  const endDate = event.endDate.clone();
  if (
    !event.startDate.isDate &&
    endProperty === null &&
    !component.hasProperty("duration")
  ) {
    endDate.adjust(0, 1, 0, 0);
  }
  const description = event.description?.trim();
  const location = event.location?.trim();
  const iCalUID = event.uid?.trim();
  const recurrence = component
    .getAllProperties()
    .filter((property) =>
      ["exdate", "exrule", "rdate", "rrule"].includes(property.name)
    )
    .map((property) => property.toICALString());
  return {
    ...(description ? { description } : {}),
    end: toCalendarDate(endDate, endProperty ?? startProperty),
    ...(iCalUID ? { iCalUID } : {}),
    ...(location ? { location } : {}),
    ...(recurrence.length > 0 ? { recurrence } : {}),
    start: toCalendarDate(event.startDate, startProperty),
    summary: event.summary?.trim() || "Calendar event",
  };
};
