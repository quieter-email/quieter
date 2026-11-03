"use client";

import {
  ComputerIcon,
  Moon02Icon,
  Sun03Icon,
} from "@hugeicons/core-free-icons";

import { COLOR_THEMES, useColorMode } from "./color-mode";
import { Icon } from "./icon";
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
  const modeIcon = colorMode === "dark" ? Moon02Icon : Sun03Icon;

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
          <Icon icon={selectedTheme === "system" ? ComputerIcon : modeIcon} />
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
                      <Icon icon={mode === "dark" ? Moon02Icon : Sun03Icon} />
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
              <Icon icon={ComputerIcon} />
              System
            </span>
          </SelectItem>
        </SelectList>
      </SelectContent>
    </Select>
  );
};
