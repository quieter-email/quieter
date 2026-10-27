"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

export type TimeFormat = "12h" | "24h";
export type WeekStartsOn = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type DateTimePreferences = {
  timeFormat: TimeFormat;
  weekStartsOn: WeekStartsOn;
};

const DateTimePreferencesContext = createContext<DateTimePreferences | null>(
  null
);
const subscribe = () => () => {
  // Browser locale has no change event to unsubscribe from.
};

export const DateTimePreferencesProvider = ({
  children,
  value,
}: {
  children: ReactNode;
  value: DateTimePreferences;
}) => (
  <DateTimePreferencesContext.Provider value={value}>
    {children}
  </DateTimePreferencesContext.Provider>
);

export const useDateTimePreferences = (): DateTimePreferences => {
  const preferences = useContext(DateTimePreferencesContext);
  const regionalTimeFormat = useSyncExternalStore<TimeFormat>(
    subscribe,
    () =>
      new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions()
        .hour12 === true
        ? "12h"
        : "24h",
    () => "24h"
  );
  return preferences ?? { timeFormat: regionalTimeFormat, weekStartsOn: 1 };
};
