import {
  calendarWallTimeToInstant,
  getZonedDateTimeFields,
} from "@quieter/calendar/time";

export const getReminderPresetTime = ({
  days,
  timeZone,
  now = new Date(),
}: {
  days: 1 | 7;
  timeZone: string;
  now?: Date;
}) => {
  const local = getZonedDateTimeFields({
    instant: now.toISOString(),
    timeZone,
  });
  const day = new Date(`${local.date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return calendarWallTimeToInstant({
    date: day.toISOString().slice(0, 10),
    disambiguation: "reject",
    time: "09:00",
    timeZone,
  });
};
