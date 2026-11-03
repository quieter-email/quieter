"use client";

import { COLOR_THEMES, useColorMode } from "./color-mode";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectList,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./select";

export const ThemePicker = () => {
  const {
    colorMode,
    configColorMode,
    isMounted,
    setColorMode,
    setTheme,
    themes,
  } = useColorMode();
  const currentTheme =
    configColorMode === "system" ? "system" : themes[colorMode];
  const selectedTheme = isMounted ? currentTheme : null;

  return (
    <Select
      items={[
        ...COLOR_THEMES.map((theme) => ({
          label: theme.label,
          value: theme.name,
        })),
        { label: "System", value: "system" },
      ]}
      onValueChange={(value) => {
        if (value === "system") {
          setColorMode("system");
        } else if (typeof value === "string") {
          setTheme(value);
        }
      }}
      value={selectedTheme}
    >
      <SelectTrigger aria-label="Theme" className="w-44" size="sm">
        {selectedTheme && (
          <span
            aria-hidden="true"
            className="theme-swatch size-4 shrink-0 rounded-full"
            data-color-theme={
              selectedTheme === "system" ? colorMode : selectedTheme
            }
          />
        )}
        <SelectValue placeholder="Theme" />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectList>
          {(["dark", "light"] as const).map((mode) => (
            <SelectGroup key={mode}>
              <SelectGroupLabel>
                {mode === "dark" ? "Dark themes" : "Light themes"}
              </SelectGroupLabel>
              {COLOR_THEMES.filter((theme) => theme.colorMode === mode).map(
                (theme) => (
                  <SelectItem key={theme.name} value={theme.name}>
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="theme-swatch size-4 shrink-0 rounded-full"
                        data-color-theme={theme.name}
                      />
                      {theme.label}
                    </span>
                  </SelectItem>
                )
              )}
            </SelectGroup>
          ))}
          <SelectSeparator />
          <SelectItem value="system">
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="theme-swatch size-4 shrink-0 rounded-full"
                data-color-theme={colorMode}
              />
              System
            </span>
          </SelectItem>
        </SelectList>
      </SelectContent>
    </Select>
  );
};
