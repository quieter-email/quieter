"use client";

import { Add01Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { useId, useRef, useState } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";

import { cn } from "../../lib/cn";
import { ActionFooter } from "./action-footer";
import { Button } from "./button";
import { ColorSwatch } from "./color-swatch";
import { Icon } from "./icon";
import { IconButtonTooltip } from "./icon-button-tooltip";
import { inputVariants } from "./input";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "./popover";

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
  swatchShape = "square",
  trigger = "default",
  value,
}: {
  disabled?: boolean;
  label: string;
  onOpenChange?: (open: boolean, outsidePress: boolean) => void;
  onValueChange: (color: string) => void;
  open?: boolean;
  presets?: readonly ColorPickerPreset[];
  swatchShape?: "circle" | "square";
  trigger?: "default" | "swatch";
  value: string;
}) => {
  const id = useId();
  const swatchRef = useRef<HTMLSpanElement>(null);
  const [pickerColor, setPickerColor] = useState("#888888");
  const [showCustom, setShowCustom] = useState(false);
  const hasPresets = (presets?.length ?? 0) > 0;
  const isCustomValue =
    hasPresets && !(presets ?? []).some((preset) => preset.color === value);

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
          ? "inline-flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-hidden disabled:pointer-events-none data-popup-open:bg-accent"
          : undefined
      }
      disabled={disabled}
      render={
        trigger === "default" ? (
          <Button size="sm" type="button" variant="outline" />
        ) : undefined
      }
    >
      <ColorSwatch color={value} ref={swatchRef} shape={swatchShape} />
      {trigger === "default" ? (
        <Icon aria-hidden icon={ArrowDown01Icon} />
      ) : null}
    </PopoverTrigger>
  );

  return (
    <Popover
      onOpenChange={(isOpen, details) => {
        onOpenChange?.(isOpen, details.reason === "outside-press");
        if (!isOpen) {
          return;
        }
        setShowCustom(false);
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
      <PopoverContent
        align="start"
        className={hasPresets ? undefined : "w-48"}
        size="compact"
      >
        <PopoverTitle className="sr-only">{label}</PopoverTitle>
        <div
          className={cn("flex flex-col gap-2", {
            // Five 28px swatch buttons and their gaps.
            "w-37": hasPresets,
            "w-full": !hasPresets,
          })}
          inert={disabled}
        >
          {hasPresets ? (
            <div className="grid grid-cols-5 gap-0.5">
              {presets?.map((preset) => (
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
                    size="icon-sm"
                    variant="ghost"
                  >
                    <ColorSwatch
                      color={preset.color}
                      selected={preset.color === value}
                      shape={swatchShape}
                      size="lg"
                    />
                  </Button>
                </IconButtonTooltip>
              ))}
              <IconButtonTooltip label="Custom color">
                <Button
                  aria-expanded={showCustom}
                  aria-label="Custom color"
                  aria-pressed={isCustomValue}
                  onClick={() => {
                    setShowCustom((shown) => !shown);
                  }}
                  size="icon-sm"
                  variant="ghost"
                >
                  {isCustomValue ? (
                    <ColorSwatch
                      color={value}
                      selected
                      shape={swatchShape}
                      size="lg"
                    />
                  ) : (
                    <Icon aria-hidden icon={Add01Icon} />
                  )}
                </Button>
              </IconButtonTooltip>
            </div>
          ) : null}
          {(!hasPresets || showCustom) && (
            <div className="flex flex-col gap-2">
              <HexColorPicker
                className="q-color-picker"
                color={pickerColor}
                onChange={changeColor}
              />
              <div className="flex items-center gap-2">
                <ColorSwatch
                  color={pickerColor}
                  shape={swatchShape}
                  size="lg"
                />
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
              <ActionFooter>
                <PopoverClose render={<Button size="compact" />}>
                  Done
                </PopoverClose>
              </ActionFooter>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
