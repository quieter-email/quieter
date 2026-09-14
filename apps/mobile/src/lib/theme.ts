import AsyncStorage from "@react-native-async-storage/async-storage";
import { Store, useSelector } from "@tanstack/react-store";
import { Uniwind } from "uniwind";

import { ignoreFailure } from "#/lib/async";

export type ThemePreference = "dark" | "light" | "system";

type ThemeState = {
  preference: ThemePreference;
};

const THEME_STORAGE_KEY = "quieter.theme-preference";
const preferences = new Set<string>(["system", "light", "dark"]);

export const themeStore = new Store<ThemeState>({ preference: "system" });

const isThemePreference = (value: string): value is ThemePreference =>
  preferences.has(value);

export const applyThemePreference = (preference: string | null) => {
  if (preference !== null && isThemePreference(preference)) {
    themeStore.setState(() => ({ preference }));
    Uniwind.setTheme(preference);
    return;
  }
  Uniwind.setTheme("system");
};

export const setThemePreference = (preference: ThemePreference) => {
  applyThemePreference(preference);
  void ignoreFailure(AsyncStorage.setItem(THEME_STORAGE_KEY, preference));
};

export const hydrateThemePreference = async () => {
  try {
    applyThemePreference(await AsyncStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    Uniwind.setTheme("system");
  }
};

export const useThemePreference = () =>
  useSelector(themeStore, (state) => state.preference);
