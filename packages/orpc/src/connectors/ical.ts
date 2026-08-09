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

const datePattern = /^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})$/u;
const dateTimePattern =
  /^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})T(?<hour>\d{2})(?<minute>\d{2})(?<second>\d{2})?(?<utc>Z)?$/u;
const recurrenceProperties = new Set(["EXDATE", "EXRULE", "RDATE", "RRULE"]);

const unfoldLines = (input: string) =>
  input
    .replaceAll(/\r?\n[ \t]/gu, "")
    .split(/\r\n|\n|\r/u)
    .filter(Boolean);

const unescapeText = (value: string) =>
  value
    .replaceAll(/\\[nN]/gu, "\n")
    .replaceAll("\\,", ",")
    .replaceAll("\\;", ";")
    .replaceAll("\\\\", "\\");

const parseParams = (parts: string[]) => {
  const params: Record<string, string> = {};

  for (const part of parts) {
    const [rawKey, ...rawValueParts] = part.split("=");
    const key = rawKey?.trim().toUpperCase();
    const value = rawValueParts.join("=").trim();
    if (key === undefined || key === "" || value === "") {
      continue;
    }

    params[key] = value.replaceAll(/^"|"$/gu, "");
  }

  return params;
};

const parseLine = (line: string): IcsProperty | null => {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }

  const nameParts = line.slice(0, separatorIndex).split(";");
  const name = nameParts[0]?.trim().toUpperCase();
  if (name === undefined || name === "") {
    return null;
  }

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

const toIsoDate = (match: RegExpMatchArray) =>
  `${match.groups?.year}-${match.groups?.month}-${match.groups?.day}`;

const addDays = (date: string, days: number) => {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const formatLocalDateTime = (date: Date) =>
  date
    .toISOString()
    .replace(/\.\d{3}Z$/u, "")
    .replace("Z", "");

const addHours = (
  date: GoogleCalendarEventDate,
  hours: number
): GoogleCalendarEventDate => {
  if (date.date !== undefined) {
    return { date: addDays(date.date, 1) };
  }

  const { dateTime } = date;
  if (dateTime === undefined || dateTime === "") {
    throw new Error("Calendar invitation includes an invalid event time.");
  }

  const value = new Date(dateTime.endsWith("Z") ? dateTime : `${dateTime}Z`);
  value.setUTCHours(value.getUTCHours() + hours);
  if (dateTime.endsWith("Z")) {
    return { dateTime: value.toISOString().replace(/\.\d{3}Z$/u, "Z") };
  }

  return { dateTime: formatLocalDateTime(value), timeZone: date.timeZone };
};

const parseIcsDuration = (value: string) => {
  const match =
    /^P(?:(?<weeks>\d+)W)?(?:(?<days>\d+)D)?(?:T(?:(?<hours>\d+)H)?(?:(?<minutes>\d+)M)?(?:(?<seconds>\d+)S)?)?$/iu.exec(
      value.trim()
    );
  if (match === null) {
    throw new Error("Calendar invitation includes an invalid event duration.");
  }

  const weeks = match.groups?.weeks ?? "0";
  const days = match.groups?.days ?? "0";
  const hours = match.groups?.hours ?? "0";
  const minutes = match.groups?.minutes ?? "0";
  const seconds = match.groups?.seconds ?? "0";
  return {
    days: Number(weeks) * 7 + Number(days),
    hours: Number(hours),
    minutes: Number(minutes),
    seconds: Number(seconds),
  };
};

const addDuration = (
  date: GoogleCalendarEventDate,
  duration: string
): GoogleCalendarEventDate => {
  const parsed = parseIcsDuration(duration);
  if (date.date !== undefined) {
    if (parsed.hours > 0 || parsed.minutes > 0 || parsed.seconds > 0) {
      throw new Error(
        "Calendar invitation includes an invalid all-day duration."
      );
    }

    return { date: addDays(date.date, parsed.days > 0 ? parsed.days : 1) };
  }

  const { dateTime } = date;
  if (dateTime === undefined || dateTime === "") {
    throw new Error("Calendar invitation includes an invalid event time.");
  }

  const value = new Date(dateTime.endsWith("Z") ? dateTime : `${dateTime}Z`);
  value.setUTCSeconds(
    value.getUTCSeconds() +
      parsed.days * 24 * 60 * 60 +
      parsed.hours * 60 * 60 +
      parsed.minutes * 60 +
      parsed.seconds
  );
  if (dateTime.endsWith("Z")) {
    return { dateTime: value.toISOString().replace(/\.\d{3}Z$/u, "Z") };
  }

  return { dateTime: formatLocalDateTime(value), timeZone: date.timeZone };
};

const parseIcsDate = (property: IcsProperty): GoogleCalendarEventDate => {
  const trimmedValue = property.value.trim();
  const dateMatch = datePattern.exec(trimmedValue);
  if (property.params.VALUE?.toUpperCase() === "DATE" || dateMatch !== null) {
    if (dateMatch === null) {
      throw new Error("Calendar invitation includes an invalid all-day date.");
    }

    return { date: toIsoDate(dateMatch) };
  }

  const dateTimeMatch = dateTimePattern.exec(trimmedValue);
  if (dateTimeMatch === null) {
    throw new Error("Calendar invitation includes an invalid event time.");
  }

  const year = dateTimeMatch.groups?.year;
  const month = dateTimeMatch.groups?.month;
  const day = dateTimeMatch.groups?.day;
  const hour = dateTimeMatch.groups?.hour;
  const minute = dateTimeMatch.groups?.minute;
  const second = dateTimeMatch.groups?.second ?? "00";
  const utc = dateTimeMatch.groups?.utc;
  const dateTime = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  if (utc !== undefined) {
    return { dateTime: `${dateTime}Z` };
  }

  const timeZone = property.params.TZID?.trim();
  if (timeZone !== undefined && timeZone !== "") {
    return { dateTime, timeZone };
  }

  return { dateTime, timeZone: "UTC" };
};

const resolveEventEnd = (
  start: GoogleCalendarEventDate,
  endProperty: IcsProperty | undefined,
  durationProperty: IcsProperty | undefined
): GoogleCalendarEventDate => {
  if (endProperty !== undefined) {
    return parseIcsDate(endProperty);
  }

  if (durationProperty !== undefined) {
    return addDuration(start, durationProperty.value);
  }

  return addHours(start, 1);
};

export const parseIcsToGoogleCalendarEvent = (
  input: string
): GoogleCalendarEventDraft => {
  const eventLines = extractFirstVEvent(unfoldLines(input));
  if (eventLines.length === 0) {
    throw new Error("Calendar invitation does not include an event.");
  }

  const properties = eventLines.flatMap((line) => {
    const property = parseLine(line);
    return property === null ? [] : [property];
  });
  const startProperty = firstProperty(properties, "DTSTART");
  if (startProperty === undefined) {
    throw new Error("Calendar invitation does not include a start time.");
  }

  const start = parseIcsDate(startProperty);
  const endProperty = firstProperty(properties, "DTEND");
  const durationProperty = firstProperty(properties, "DURATION");
  const end = resolveEventEnd(start, endProperty, durationProperty);
  const summary = unescapeText(
    firstProperty(properties, "SUMMARY")?.value ?? ""
  ).trim();
  const description = unescapeText(
    firstProperty(properties, "DESCRIPTION")?.value ?? ""
  ).trim();
  const location = unescapeText(
    firstProperty(properties, "LOCATION")?.value ?? ""
  ).trim();
  const iCalUID = firstProperty(properties, "UID")?.value.trim();
  const recurrence = properties
    .filter((property) => recurrenceProperties.has(property.name))
    .map((property) => property.raw.trim())
    .filter((value) => value !== "");

  return {
    ...(description === "" ? {} : { description }),
    end,
    ...(iCalUID === undefined || iCalUID === "" ? {} : { iCalUID }),
    ...(location === "" ? {} : { location }),
    ...(recurrence.length === 0 ? {} : { recurrence }),
    start,
    summary: summary === "" ? "Calendar event" : summary,
  };
};
