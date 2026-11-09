import { getZonedDateTimeFields } from "@quieter/calendar/time";
import type { Reminder } from "@quieter/mail/reminders";
import { useDateTimePreferences } from "@quieter/ui/date-time-preferences";
import { Tooltip, TooltipContent, TooltipTrigger } from "@quieter/ui/tooltip";

export const ReminderRowTime = ({
  reminder,
  now,
}: {
  reminder: Reminder;
  now: number;
}) => {
  const { timeFormat } = useDateTimePreferences();
  const today = getZonedDateTimeFields({
    instant: new Date(now).toISOString(),
    timeZone: reminder.timeZone,
  }).date;
  const day = new Date(`${today}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  const dueDay = getZonedDateTimeFields({
    instant: reminder.dueAt,
    timeZone: reminder.timeZone,
  }).date;
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    hour12: timeFormat === "12h",
    minute: "2-digit",
    timeZone: reminder.timeZone,
  }).format(new Date(reminder.dueAt));
  let label = time;
  if (dueDay === day.toISOString().slice(0, 10)) {
    label = `Tomorrow ${time}`;
  } else if (dueDay !== today) {
    label = `${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: reminder.timeZone }).format(new Date(reminder.dueAt))}, ${time}`;
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<time dateTime={reminder.dueAt} />}>
        <span className="text-caption text-muted-fg">{label}</span>
      </TooltipTrigger>
      <TooltipContent>
        {new Intl.DateTimeFormat(undefined, {
          dateStyle: "full",
          timeStyle: "long",
          timeZone: reminder.timeZone,
        }).format(new Date(reminder.dueAt))}
        {", "}
        {reminder.timeZone}
      </TooltipContent>
    </Tooltip>
  );
};
