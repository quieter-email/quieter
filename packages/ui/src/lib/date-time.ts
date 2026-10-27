export const parseDateValue = (value: string): Date | undefined => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return undefined;
  }
  const [year, month, day] = value.split("-").map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    year < 1
  ) {
    return undefined;
  }
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : undefined;
};

export const parseTimeValue = (value: string): string | undefined => {
  const match =
    /^(?<hour>\d{1,2})(?::(?<minute>\d{2}))?\s*(?<period>am|pm)?$/iu.exec(
      value.trim()
    );
  if (!match) {
    return undefined;
  }
  let hour = Number(match.groups?.hour);
  const minute = Number(match.groups?.minute ?? "0");
  const period = match.groups?.period?.toLowerCase();
  if (minute > 59 || hour > (period ? 12 : 23) || (period && hour < 1)) {
    return undefined;
  }
  if (period) {
    hour = (hour % 12) + (period === "pm" ? 12 : 0);
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

export const formatTimeMinute = (
  minute: number,
  timeFormat: "12h" | "24h"
): string => {
  const hour = Math.floor(minute / 60) % 24;
  const minutes = String(Math.floor(minute % 60)).padStart(2, "0");
  return timeFormat === "12h"
    ? `${hour % 12 || 12}:${minutes} ${hour < 12 ? "AM" : "PM"}`
    : `${String(hour).padStart(2, "0")}:${minutes}`;
};
