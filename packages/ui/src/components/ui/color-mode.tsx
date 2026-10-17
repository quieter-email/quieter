"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { PropsWithChildren } from "react";

import { BRAND_THEMES } from "../../lib/brand-themes";

export const COLOR_MODE_STORAGE_KEY = "quieter-color-mode";

export type ColorMode = "light" | "dark";
export type ConfigColorMode = ColorMode | "system";

export const COLOR_THEMES: {
  colorMode: ColorMode;
  label: string;
  name: string;
}[] = [
  { colorMode: "dark", label: "Dark", name: "dark" },
  { colorMode: "light", label: "Light", name: "light" },
  ...BRAND_THEMES,
];

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
  themes: Record<ColorMode, string>;
  setTheme: (name: string) => void;
};

const ColorModeContext = createContext<ColorModeContextValue | null>(null);

const subscribeToHydration = () => () => {
  /* hydration snapshot only */
};
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

const subscribeToSystemColorMode = (onStoreChange: () => void) => {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", onStoreChange);
  return () => {
    mediaQuery.removeEventListener("change", onStoreChange);
  };
};

const getSystemColorModeSnapshot = () =>
  window.matchMedia("(prefers-color-scheme: dark)").matches;

const isConfigColorMode = (value: string | null): value is ConfigColorMode =>
  value === "light" || value === "dark" || value === "system";

const readStoredColorMode = (
  initialColorMode: ConfigColorMode
): ConfigColorMode => {
  if (typeof window === "undefined") {
    return initialColorMode;
  }

  try {
    const storedColorMode = localStorage.getItem(COLOR_MODE_STORAGE_KEY);
    return isConfigColorMode(storedColorMode)
      ? storedColorMode
      : initialColorMode;
  } catch {
    return initialColorMode;
  }
};

const resolveColorMode = (
  configColorMode: ConfigColorMode,
  systemIsDark: boolean
): ColorMode => {
  if (configColorMode === "system") {
    return systemIsDark ? "dark" : "light";
  }

  return configColorMode;
};

const getNextColorMode = (
  configColorMode: ConfigColorMode
): ConfigColorMode => {
  if (configColorMode === "light") {
    return "dark";
  }

  if (configColorMode === "dark") {
    return "system";
  }

  return "light";
};

const readStoredTheme = (mode: ColorMode) => {
  try {
    const stored = localStorage.getItem(`quieter-theme-${mode}`);
    return (
      COLOR_THEMES.find(
        (theme) => theme.name === stored && theme.colorMode === mode
      )?.name ?? mode
    );
  } catch {
    return mode;
  }
};

const colorModeScript = (
  initialColorMode: ConfigColorMode,
  forcedTheme?: ColorMode
) =>
  `try{const stored=localStorage.getItem("${COLOR_MODE_STORAGE_KEY}");const configured=stored==="light"||stored==="dark"||stored==="system"?stored:"${initialColorMode}";const mode=${forcedTheme === undefined ? "false" : "true"}?"${forcedTheme ?? "light"}":configured==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):configured;document.documentElement.classList.add(mode);document.documentElement.style.colorScheme=mode;const themes=${JSON.stringify(COLOR_THEMES.map(({ name, colorMode }) => ({ colorMode, name })))};const saved=localStorage.getItem("quieter-theme-"+mode);const theme=themes.find(t=>t.name===saved&&t.colorMode===mode)?.name||mode;if(${forcedTheme !== undefined}||theme===mode)delete document.documentElement.dataset.colorTheme;else document.documentElement.dataset.colorTheme=theme}catch{}`;

export const ColorModeProvider = ({
  children,
  forcedTheme,
  initialColorMode = "system",
}: ColorModeProviderProps) => {
  const [configColorMode, setConfigColorMode] = useState<ConfigColorMode>(() =>
    readStoredColorMode(initialColorMode)
  );
  const [themes, setThemes] = useState(() => ({
    dark: readStoredTheme("dark"),
    light: readStoredTheme("light"),
  }));
  const isMounted = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot
  );
  const systemIsDark = useSyncExternalStore(
    subscribeToSystemColorMode,
    getSystemColorModeSnapshot,
    () => initialColorMode === "dark"
  );
  const colorMode =
    forcedTheme ?? resolveColorMode(configColorMode, systemIsDark);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === "quieter-theme-light" ||
        event.key === "quieter-theme-dark"
      ) {
        setThemes({
          dark: readStoredTheme("dark"),
          light: readStoredTheme("light"),
        });
      }
      if (
        event.key === COLOR_MODE_STORAGE_KEY &&
        isConfigColorMode(event.newValue)
      ) {
        setConfigColorMode(event.newValue);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(colorMode);
    document.documentElement.style.colorScheme = colorMode;
    if (forcedTheme || themes[colorMode] === colorMode) {
      delete document.documentElement.dataset.colorTheme;
    } else {
      document.documentElement.dataset.colorTheme = themes[colorMode];
    }
  }, [colorMode, forcedTheme, themes]);

  const setColorMode = useCallback((value: ConfigColorMode) => {
    try {
      localStorage.setItem(COLOR_MODE_STORAGE_KEY, value);
    } catch {
      /* The preference remains available for this session. */
    }
    setConfigColorMode(value);
  }, []);

  const setTheme = useCallback(
    (name: string) => {
      const theme = COLOR_THEMES.find((option) => option.name === name);
      if (!theme) {
        return;
      }
      try {
        localStorage.setItem(`quieter-theme-${theme.colorMode}`, name);
      } catch {
        /* The preference remains available for this session. */
      }
      setThemes((current) => ({ ...current, [theme.colorMode]: name }));
      if (configColorMode !== "system" || theme.colorMode !== colorMode) {
        setColorMode(theme.colorMode);
      }
    },
    [colorMode, configColorMode, setColorMode]
  );

  const cycleColorMode = useCallback(() => {
    const next = getNextColorMode(configColorMode);
    setColorMode(next);
  }, [configColorMode, setColorMode]);

  const value = useMemo(
    () => ({
      colorMode,
      configColorMode,
      cycleColorMode,
      forcedTheme,
      isMounted,
      setColorMode,
      setTheme,
      themes,
    }),
    [
      colorMode,
      configColorMode,
      cycleColorMode,
      forcedTheme,
      isMounted,
      setColorMode,
      themes,
      setTheme,
    ]
  );

  return (
    <ColorModeContext.Provider value={value}>
      {children}
    </ColorModeContext.Provider>
  );
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
  forcedTheme,
  initialColorMode = "system",
}: {
  initialColorMode?: ConfigColorMode;
  forcedTheme?: ColorMode;
}) => (
  <script suppressHydrationWarning>
    {colorModeScript(initialColorMode, forcedTheme)}
  </script>
);
