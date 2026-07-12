"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";

export const COLOR_MODE_STORAGE_KEY = "quieter-color-mode";

export type ColorMode = "light" | "dark";
export type ConfigColorMode = ColorMode | "system";

export type ColorModeProviderProps = PropsWithChildren<{
  forcedTheme?: ColorMode;
  initialColorMode?: ConfigColorMode;
}>;

type ColorModeContextValue = {
  colorMode: ColorMode;
  configColorMode: ConfigColorMode;
  cycleColorMode: () => void;
  forcedTheme?: ColorMode;
  isMounted: boolean;
  setColorMode: (value: ConfigColorMode) => void;
};

const ColorModeContext = createContext<ColorModeContextValue | null>(null);

const subscribeToHydration = () => () => {};
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

const subscribeToSystemColorMode = (onStoreChange: () => void) => {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
};

const getSystemColorModeSnapshot = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

const isConfigColorMode = (value: string | null): value is ConfigColorMode =>
  value === "light" || value === "dark" || value === "system";

export const ColorModeProvider = ({
  children,
  forcedTheme,
  initialColorMode = "system",
}: ColorModeProviderProps) => {
  const [configColorMode, setConfigColorMode] = useState(initialColorMode);
  const isMounted = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  );
  const systemIsDark = useSyncExternalStore(
    subscribeToSystemColorMode,
    getSystemColorModeSnapshot,
    () => initialColorMode === "dark",
  );
  const colorMode =
    forcedTheme ??
    (configColorMode === "system" ? (systemIsDark ? "dark" : "light") : configColorMode);

  useEffect(() => {
    const storedColorMode = localStorage.getItem(COLOR_MODE_STORAGE_KEY);
    if (isConfigColorMode(storedColorMode)) {
      setConfigColorMode(storedColorMode);
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === COLOR_MODE_STORAGE_KEY && isConfigColorMode(event.newValue)) {
        setConfigColorMode(event.newValue);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(colorMode);
    document.documentElement.style.colorScheme = colorMode;
  }, [colorMode]);

  const setColorMode = useCallback((value: ConfigColorMode) => {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, value);
    setConfigColorMode(value);
  }, []);

  const cycleColorMode = useCallback(() => {
    const next =
      configColorMode === "light" ? "dark" : configColorMode === "dark" ? "system" : "light";
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, next);
    setConfigColorMode(next);
  }, [configColorMode]);

  const value = useMemo(
    () => ({
      colorMode,
      configColorMode,
      cycleColorMode,
      forcedTheme,
      isMounted,
      setColorMode,
    }),
    [colorMode, configColorMode, cycleColorMode, forcedTheme, isMounted, setColorMode],
  );

  return <ColorModeContext.Provider value={value}>{children}</ColorModeContext.Provider>;
};

export const useColorMode = () => {
  const context = useContext(ColorModeContext);
  if (!context) {
    throw new Error("useColorMode must be used within ColorModeProvider");
  }
  return context;
};

export const useColorModeValue = <T,>(light: T, dark: T) => {
  const { colorMode } = useColorMode();
  return colorMode === "dark" ? dark : light;
};

export const ColorModeScript = ({
  initialColorMode = "system",
}: {
  initialColorMode?: ConfigColorMode;
}) => (
  <script
    dangerouslySetInnerHTML={{
      __html: `try{const stored=localStorage.getItem("${COLOR_MODE_STORAGE_KEY}");const configured=stored==="light"||stored==="dark"||stored==="system"?stored:"${initialColorMode}";const mode=location.pathname==="/home"?"dark":configured==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):configured;document.documentElement.classList.add(mode);document.documentElement.style.colorScheme=mode}catch{}`,
    }}
    suppressHydrationWarning
  />
);
