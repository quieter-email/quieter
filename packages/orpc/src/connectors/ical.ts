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

type IcsProperty = {
  name: string;
  params: Record<string, string>;
  raw: string;
  value: string;
};

const datePattern = /^(\d{4})(\d{2})(\d{2})$/;
const dateTimePattern = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/;
const recurrenceProperties = new Set(["EXDATE", "EXRULE", "RDATE", "RRULE"]);

const unfoldLines = (input: string) =>
  input
    .replaceAll(/\r?\n[ \t]/g, "")
    .split(/\r\n|\n|\r/)
    .filter(Boolean);

const unescapeText = (value: string) =>
  value
    .replaceAll(/\\[nN]/g, "\n")
    .replaceAll("\\,", ",")
    .replaceAll("\\;", ";")
    .replaceAll("\\\\", "\\");

const parseParams = (parts: string[]) => {
  const params: Record<string, string> = {};

  for (const part of parts) {
    const [rawKey, ...rawValueParts] = part.split("=");
    const key = rawKey?.trim().toUpperCase();
    const value = rawValueParts.join("=").trim();
    if (!key || !value) continue;

    params[key] = value.replace(/^"|"$/g, "");
  }

  return params;
};

const parseLine = (line: string): IcsProperty | null => {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex <= 0) return null;

  const nameParts = line.slice(0, separatorIndex).split(";");
  const name = nameParts[0]?.trim().toUpperCase();
  if (!name) return null;

  return {
    name,
    params: parseParams(nameParts.slice(1)),
    raw: line,
    value: line.slice(separatorIndex + 1),
  };
};

const extractFirstVEvent = (lines: string[]) => {
  const eventLines: string[] = [];
  let insideEvent = false;

  for (const line of lines) {
    const normalized = line.trim().toUpperCase();
    if (normalized === "BEGIN:VEVENT") {
      insideEvent = true;
      eventLines.length = 0;
      continue;
    }

    if (normalized === "END:VEVENT" && insideEvent) {
      return eventLines;
    }

    if (insideEvent) {
      eventLines.push(line);
    }
  }

  return [];
};

const firstProperty = (properties: IcsProperty[], name: string) =>
  properties.find((property) => property.name === name);

const toIsoDate = (match: RegExpMatchArray) => `${match[1]}-${match[2]}-${match[3]}`;

const addDays = (date: string, days: number) => {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const formatLocalDateTime = (date: Date) =>
  date
    .toISOString()
    .replace(/\.\d{3}Z$/, "")
    .replace("Z", "");

const addHours = (date: GoogleCalendarEventDate, hours: number): GoogleCalendarEventDate => {
  if (date.date) {
    return { date: addDays(date.date, 1) };
  }

  const dateTime = date.dateTime;
  if (!dateTime) {
    throw new Error("Calendar invitation includes an invalid event time.");
  }

  const value = new Date(dateTime.endsWith("Z") ? dateTime : `${dateTime}Z`);
  value.setUTCHours(value.getUTCHours() + hours);
  return dateTime.endsWith("Z")
    ? { dateTime: value.toISOString().replace(/\.\d{3}Z$/, "Z") }
    : { dateTime: formatLocalDateTime(value), timeZone: date.timeZone };
};

const parseIcsDate = (property: IcsProperty): GoogleCalendarEventDate => {
  const trimmedValue = property.value.trim();
  const dateMatch = trimmedValue.match(datePattern);
  if (property.params.VALUE?.toUpperCase() === "DATE" || dateMatch) {
    if (!dateMatch) {
      throw new Error("Calendar invitation includes an invalid all-day date.");
    }

    return { date: toIsoDate(dateMatch) };
  }

  const dateTimeMatch = trimmedValue.match(dateTimePattern);
  if (!dateTimeMatch) {
    throw new Error("Calendar invitation includes an invalid event time.");
  }

  const [, year, month, day, hour, minute, second = "00", utc] = dateTimeMatch;
  const dateTime = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  if (utc) {
    return { dateTime: `${dateTime}Z` };
  }

  const timeZone = property.params.TZID?.trim();
  return timeZone ? { dateTime, timeZone } : { dateTime, timeZone: "UTC" };
};

export const parseIcsToGoogleCalendarEvent = (input: string): GoogleCalendarEventDraft => {
  const eventLines = extractFirstVEvent(unfoldLines(input));
  if (eventLines.length === 0) {
    throw new Error("Calendar invitation does not include an event.");
  }

  const properties = eventLines.flatMap((line) => {
    const property = parseLine(line);
    return property ? [property] : [];
  });
  const startProperty = firstProperty(properties, "DTSTART");
  if (!startProperty) {
    throw new Error("Calendar invitation does not include a start time.");
  }

  const start = parseIcsDate(startProperty);
  const endProperty = firstProperty(properties, "DTEND");
  const end = endProperty ? parseIcsDate(endProperty) : addHours(start, 1);
  const summary = unescapeText(firstProperty(properties, "SUMMARY")?.value ?? "").trim();
  const description = unescapeText(firstProperty(properties, "DESCRIPTION")?.value ?? "").trim();
  const location = unescapeText(firstProperty(properties, "LOCATION")?.value ?? "").trim();
  const iCalUID = firstProperty(properties, "UID")?.value.trim();
  const recurrence = properties
    .filter((property) => recurrenceProperties.has(property.name))
    .map((property) => property.raw.trim())
    .filter(Boolean);

  return {
    ...(description ? { description } : {}),
    end,
    ...(iCalUID ? { iCalUID } : {}),
    ...(location ? { location } : {}),
    ...(recurrence.length > 0 ? { recurrence } : {}),
    start,
    summary: summary || "Calendar event",
  };
};
