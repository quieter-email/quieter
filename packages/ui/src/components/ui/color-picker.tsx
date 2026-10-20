"use client";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useId, useRef, useState } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";

import { Button } from "./button";
import { ColorSwatch } from "./color-swatch";
import { inputVariants } from "./input";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "./popover";

export const ColorPicker = ({
  disabled = false,
  label,
  onValueChange,
  value,
}: {
  disabled?: boolean;
  label: string;
  onValueChange: (color: string) => void;
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
    setPickerColor(color);
    onValueChange(hex);
  };

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) {
          return;
        }
        if (value.startsWith("#")) {
          setPickerColor(value);
          return;
        }
        const context = document.createElement("canvas").getContext("2d");
        if (context && swatchRef.current) {
          context.fillStyle = getComputedStyle(
            swatchRef.current
          ).backgroundColor;
          context.fillRect(0, 0, 1, 1);
          const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
          setPickerColor(
            `#${[red, green, blue].map((channel) => (channel ?? 0).toString(16).padStart(2, "0")).join("")}`
          );
        }
      }}
    >
      <PopoverTrigger
        aria-label={label}
        disabled={disabled}
        render={<Button size="sm" type="button" variant="outline" />}
      >
        <ColorSwatch color={value} ref={swatchRef} shape="square" />
        <HugeiconsIcon aria-hidden icon={ArrowDown01Icon} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60">
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
        </div>
      </PopoverContent>
    </Popover>
  );
};
