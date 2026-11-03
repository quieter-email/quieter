"use client";

import { createContext, useContext } from "react";
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

export const useDateTimePreferences = (): DateTimePreferences =>
  useContext(DateTimePreferencesContext) ?? {
    timeFormat: "24h",
    weekStartsOn: 1,
  };
