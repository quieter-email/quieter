"use client";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { useId, useRef, useState } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";

import { Button } from "./button";
import { ColorSwatch } from "./color-swatch";
import { Icon } from "./icon";
import { IconButtonTooltip } from "./icon-button-tooltip";
import { inputVariants } from "./input";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "./popover";
import { Separator } from "./separator";

type ColorPickerPreset = {
  color: string;
  label: string;
  value: string;
};

const readSwatchColor = (swatch: Element | null) => {
  const context = document.createElement("canvas").getContext("2d");
  if (!(context && swatch)) {
    return null;
  }
  context.fillStyle = getComputedStyle(swatch).backgroundColor;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return `#${[red, green, blue].map((channel) => (channel ?? 0).toString(16).padStart(2, "0")).join("")}`;
};

export const ColorPicker = ({
  disabled = false,
  label,
  onOpenChange,
  onValueChange,
  open,
  presets,
  trigger = "default",
  value,
}: {
  disabled?: boolean;
  label: string;
  onOpenChange?: (open: boolean) => void;
  onValueChange: (color: string) => void;
  open?: boolean;
  presets?: readonly ColorPickerPreset[];
  trigger?: "default" | "swatch";
  value: string;
}) => {
  const id = useId();
  const swatchRef = useRef<HTMLSpanElement>(null);
  const [pickerColor, setPickerColor] = useState("#888888");

  const changeColor = (color: string) => {
    const hex =
      color.length === 4
        ? `#${color
            .slice(1)
            .split("")
            .map((digit) => `${digit}${digit}`)
            .join("")}`
        : color.toLowerCase();
    setPickerColor(hex);
    onValueChange(hex);
  };

  const pickerTrigger = (
    <PopoverTrigger
      aria-label={label}
      className={
        trigger === "swatch"
          ? "inline-flex size-3 shrink-0 items-center justify-center rounded-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
          : undefined
      }
      disabled={disabled}
      render={
        trigger === "default" ? (
          <Button size="sm" type="button" variant="outline" />
        ) : undefined
      }
    >
      <ColorSwatch color={value} ref={swatchRef} shape="square" />
      {trigger === "default" ? (
        <Icon aria-hidden icon={ArrowDown01Icon} />
      ) : null}
    </PopoverTrigger>
  );

  return (
    <Popover
      onOpenChange={(isOpen) => {
        onOpenChange?.(isOpen);
        if (!isOpen) {
          return;
        }
        if (value.startsWith("#")) {
          setPickerColor(value);
          return;
        }
        const color = readSwatchColor(swatchRef.current);
        if (color) {
          setPickerColor(color);
        }
      }}
      open={open}
    >
      {trigger === "swatch" ? (
        <IconButtonTooltip label={label}>{pickerTrigger}</IconButtonTooltip>
      ) : (
        pickerTrigger
      )}
      <PopoverContent align="start" className="w-64">
        <PopoverTitle className="sr-only">{label}</PopoverTitle>
        <div className="flex flex-col gap-4" inert={disabled}>
          <HexColorPicker
            className="q-color-picker"
            color={pickerColor}
            onChange={changeColor}
          />
          <div className="flex items-center gap-3">
            <ColorSwatch color={pickerColor} shape="square" size="lg" />
            <label className="sr-only" htmlFor={`${id}-hex`}>
              Hex color
            </label>
            <HexColorInput
              className={inputVariants({ size: "sm" })}
              color={pickerColor}
              disabled={disabled}
              id={`${id}-hex`}
              onChange={changeColor}
              prefixed
              spellCheck={false}
            />
          </div>
          {presets && presets.length > 0 ? (
            <>
              <Separator />
              <div
                aria-label="Preset colors"
                className="grid grid-cols-[repeat(auto-fit,1.5rem)] justify-between gap-3"
              >
                {presets.map((preset) => (
                  <IconButtonTooltip key={preset.value} label={preset.label}>
                    <Button
                      aria-label={preset.label}
                      aria-pressed={preset.color === value}
                      disabled={disabled}
                      onClick={(event) => {
                        const color = readSwatchColor(
                          event.currentTarget.firstElementChild
                        );
                        if (color) {
                          setPickerColor(color);
                        }
                        onValueChange(preset.value);
                      }}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <ColorSwatch
                        color={preset.color}
                        shape="square"
                        size="lg"
                      />
                    </Button>
                  </IconButtonTooltip>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
};
