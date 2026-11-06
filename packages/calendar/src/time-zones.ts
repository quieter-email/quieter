import windowsZones from "cldr-core/supplemental/windowsZones.json" with { type: "json" };

import { calendarTimeZoneSchema } from "./contracts";

const windowsTimeZones = new Map(
  windowsZones.supplemental.windowsZones.mapTimezones
    .filter(({ mapZone }) => mapZone._territory === "001")
    .map(({ mapZone }) => [mapZone._other, mapZone._type])
);

export const resolveCalendarTimeZone = (timeZone: string | undefined) => {
  const normalized = calendarTimeZoneSchema.safeParse(
    windowsTimeZones.get(timeZone ?? "") ?? timeZone
  );
  return normalized.success ? normalized.data : undefined;
};
