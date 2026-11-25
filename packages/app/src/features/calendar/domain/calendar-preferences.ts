import { z } from "zod";

const calendarPreferencesSchema = z.object({
  hiddenCalendarKeys: z.array(z.string()).max(100),
  sidebarCollapsed: z.boolean().default(false),
});

export type CalendarPreferences = z.infer<typeof calendarPreferencesSchema>;

export const getCalendarPreferencesKey = (
  userId: string,
  preview: string | null
) => `quieter:calendar-preferences:${userId}:${preview ?? "live"}`;

export const readCalendarPreferences = (key: string): CalendarPreferences => {
  const fallback = { hiddenCalendarKeys: [], sidebarCollapsed: false };
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(key) ?? "null"
    );
    const preferences = calendarPreferencesSchema.safeParse(parsed);
    return preferences.success ? preferences.data : fallback;
  } catch {
    return fallback;
  }
};
