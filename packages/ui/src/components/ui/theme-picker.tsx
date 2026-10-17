"use client";

import { COLOR_THEMES, useColorMode } from "./color-mode";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectList,
  SelectTrigger,
  SelectValue,
} from "./select";

export const ThemePicker = () => {
  const { colorMode, isMounted, setTheme, themes } = useColorMode();
  const selectedTheme = isMounted ? themes[colorMode] : null;

  return (
    <Select
      items={COLOR_THEMES.map((theme) => ({
        label: theme.label,
        value: theme.name,
      }))}
      onValueChange={(value) => {
        if (typeof value === "string") {
          setTheme(value);
        }
      }}
      value={selectedTheme}
    >
      <SelectTrigger aria-label="Theme" className="w-44" size="sm">
        {selectedTheme && (
          <span
            aria-hidden="true"
            className="theme-swatch size-4 shrink-0 rounded-sm border border-border [background:linear-gradient(135deg,var(--theme-base),var(--theme-accent),var(--theme-light))]"
            data-color-theme={selectedTheme}
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
                        className="theme-swatch size-4 shrink-0 rounded-sm border border-border [background:linear-gradient(135deg,var(--theme-base),var(--theme-accent),var(--theme-light))]"
                        data-color-theme={theme.name}
                      />
                      {theme.label}
                    </span>
                  </SelectItem>
                )
              )}
            </SelectGroup>
          ))}
        </SelectList>
      </SelectContent>
    </Select>
  );
};
