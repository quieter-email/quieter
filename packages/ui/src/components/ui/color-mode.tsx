"use client";

import { ThemeProvider, useTheme } from "next-themes";
import { useSyncExternalStore, type PropsWithChildren } from "react";

export const COLOR_MODE_STORAGE_KEY = "quieter-color-mode";

export type ColorMode = "light" | "dark";
export type ConfigColorMode = ColorMode | "system";

export type ColorModeProviderProps = PropsWithChildren<{
  initialColorMode?: ConfigColorMode;
}>;

const subscribeToHydration = () => () => {};
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

export const ColorModeProvider = ({
  children,
  initialColorMode = "system",
}: ColorModeProviderProps) => {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme={initialColorMode}
      disableTransitionOnChange
      enableColorScheme
      enableSystem
      storageKey={COLOR_MODE_STORAGE_KEY}
    >
      {children}
    </ThemeProvider>
  );
};

export const useColorMode = () => {
  const { resolvedTheme, setTheme, theme } = useTheme();
  const isMounted = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  );

  const configColorMode =
    theme === "light" || theme === "dark" || theme === "system" ? theme : "system";
  const colorMode: ColorMode = isMounted && resolvedTheme === "dark" ? "dark" : "light";
  const setColorMode = (value: ConfigColorMode) => {
    setTheme(value);
  };

  const cycleColorMode = () => {
    if (configColorMode === "light") {
      setTheme("dark");
    } else if (configColorMode === "dark") {
      setTheme("system");
    } else {
      setTheme("light");
    }
  };

  return {
    colorMode,
    configColorMode,
    cycleColorMode,
    isMounted,
    setColorMode,
  };
};

export const useColorModeValue = <T,>(light: T, dark: T) => {
  const { colorMode } = useColorMode();
  return colorMode === "dark" ? dark : light;
};

export const ColorModeScript = ({
  initialColorMode: _initialColorMode = "system",
}: {
  initialColorMode?: ConfigColorMode;
}) => null;
