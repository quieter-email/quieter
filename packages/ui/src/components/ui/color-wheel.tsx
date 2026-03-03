import type { ComponentProps } from "solid-js";
import * as ColorWheelPrimitive from "@kobalte/core/color-wheel";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

export type ColorWheelProps = Omit<ComponentProps<typeof ColorWheelPrimitive.Root>, "thickness"> & {
  thickness?: number;
};

export const ColorWheel = (props: ColorWheelProps) => {
  const [local, others] = splitProps(props, ["class", "thickness"]);

  return (
    <ColorWheelPrimitive.Root
      thickness={local.thickness ?? 24}
      class={cn("grid w-fit gap-2", local.class)}
      {...others}
    />
  );
};

export type ColorWheelLabelProps = ComponentProps<typeof ColorWheelPrimitive.Label>;

export const ColorWheelLabel = (props: ColorWheelLabelProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ColorWheelPrimitive.Label
      class={cn(
        "text-sm leading-none font-medium text-foreground data-disabled:opacity-60",
        local.class,
      )}
      {...others}
    />
  );
};

export type ColorWheelTrackProps = ComponentProps<typeof ColorWheelPrimitive.Track>;

export const ColorWheelTrack = (props: ColorWheelTrackProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ColorWheelPrimitive.Track
      class={cn(
        "relative size-48 rounded-full border border-input bg-muted/50 shadow-sm data-disabled:opacity-60",
        local.class,
      )}
      {...others}
    />
  );
};

export type ColorWheelThumbProps = ComponentProps<typeof ColorWheelPrimitive.Thumb>;

export const ColorWheelThumb = (props: ColorWheelThumbProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ColorWheelPrimitive.Thumb
      class={cn(
        "size-4 border-2 border-background bg-foreground shadow-[0_0_0_1px_var(--color-border)]",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    />
  );
};

export type ColorWheelValueLabelProps = ComponentProps<typeof ColorWheelPrimitive.ValueLabel>;

export const ColorWheelValueLabel = (props: ColorWheelValueLabelProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ColorWheelPrimitive.ValueLabel
      class={cn("text-xs text-muted-foreground", local.class)}
      {...others}
    />
  );
};

export type ColorWheelInputProps = ComponentProps<typeof ColorWheelPrimitive.Input>;

export const ColorWheelInput = (props: ColorWheelInputProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <ColorWheelPrimitive.Input class={cn("sr-only", local.class)} {...others} />;
};

export type ColorWheelDescriptionProps = ComponentProps<typeof ColorWheelPrimitive.Description>;

export const ColorWheelDescription = (props: ColorWheelDescriptionProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ColorWheelPrimitive.Description
      class={cn("text-xs text-muted-foreground data-disabled:opacity-60", local.class)}
      {...others}
    />
  );
};

export type ColorWheelErrorMessageProps = ComponentProps<typeof ColorWheelPrimitive.ErrorMessage>;

export const ColorWheelErrorMessage = (props: ColorWheelErrorMessageProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ColorWheelPrimitive.ErrorMessage
      class={cn("text-xs text-destructive", local.class)}
      {...others}
    />
  );
};
