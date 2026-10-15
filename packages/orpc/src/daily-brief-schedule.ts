export const dailyBriefLocalClock = (now: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
};

export const nextDailyBriefRun = ({
  afterLocalDate,
  now,
  localTime,
  timeZone,
}: {
  afterLocalDate?: string;
  now: Date;
  localTime: string;
  timeZone: string;
}) => {
  const current = dailyBriefLocalClock(now, timeZone);
  const targetDate =
    current.time < localTime && current.date !== afterLocalDate
      ? current.date
      : new Date(Date.parse(`${current.date}T12:00:00Z`) + 86_400_000)
          .toISOString()
          .slice(0, 10);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  });
  // Minute scanning chooses the first occurrence on fall-back days and the first
  // valid wall-clock minute after a missing spring-forward time.
  for (let minute = 1; minute <= 2880; minute += 1) {
    const candidate = new Date(
      Math.floor(now.getTime() / 60_000) * 60_000 + minute * 60_000
    );
    const values = Object.fromEntries(
      formatter.formatToParts(candidate).map((part) => [part.type, part.value])
    );
    const date = `${values.year}-${values.month}-${values.day}`;
    const time = `${values.hour}:${values.minute}`;
    if (date > targetDate || (date === targetDate && time >= localTime)) {
      return candidate;
    }
  }
  throw new Error("Could not resolve Daily Brief schedule.");
};
