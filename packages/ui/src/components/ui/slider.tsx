import type { ComponentProps } from "solid-js";
import * as SliderPrimitive from "@kobalte/core/slider";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

export type SliderProps = ComponentProps<typeof SliderPrimitive.Root>;

export const Slider = (props: SliderProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SliderPrimitive.Root
      class={cn(
        "grid w-full gap-2 data-[orientation=horizontal]:grid-cols-1 data-[orientation=vertical]:h-48 data-[orientation=vertical]:w-12",
        local.class,
      )}
      {...others}
    />
  );
};

export type SliderLabelProps = ComponentProps<typeof SliderPrimitive.Label>;

export const SliderLabel = (props: SliderLabelProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SliderPrimitive.Label
      class={cn(
        "text-sm leading-none font-medium text-foreground data-disabled:opacity-60",
        local.class,
      )}
      {...others}
    />
  );
};

export type SliderValueLabelProps = ComponentProps<typeof SliderPrimitive.ValueLabel>;

export const SliderValueLabel = (props: SliderValueLabelProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SliderPrimitive.ValueLabel
      class={cn("text-xs text-muted-foreground", local.class)}
      {...others}
    />
  );
};

export type SliderTrackProps = ComponentProps<typeof SliderPrimitive.Track>;

export const SliderTrack = (props: SliderTrackProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SliderPrimitive.Track
      class={cn(
        "relative border border-input bg-muted/60 data-[orientation=horizontal]:h-2 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2",
        local.class,
      )}
      {...others}
    />
  );
};

export type SliderFillProps = ComponentProps<typeof SliderPrimitive.Fill>;

export const SliderFill = (props: SliderFillProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SliderPrimitive.Fill
      class={cn(
        "absolute bg-primary data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full",
        local.class,
      )}
      {...others}
    />
  );
};

export type SliderThumbProps = ComponentProps<typeof SliderPrimitive.Thumb>;

export const SliderThumb = (props: SliderThumbProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SliderPrimitive.Thumb
      class={cn(
        "block size-4 border border-primary bg-background text-primary shadow-sm transition-transform data-[dragging]:scale-105",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    />
  );
};

export type SliderInputProps = ComponentProps<typeof SliderPrimitive.Input>;

export const SliderInput = (props: SliderInputProps) => <SliderPrimitive.Input {...props} />;

export type SliderDescriptionProps = ComponentProps<typeof SliderPrimitive.Description>;

export const SliderDescription = (props: SliderDescriptionProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SliderPrimitive.Description
      class={cn("text-xs text-muted-foreground data-disabled:opacity-60", local.class)}
      {...others}
    />
  );
};

export type SliderErrorMessageProps = ComponentProps<typeof SliderPrimitive.ErrorMessage>;

export const SliderErrorMessage = (props: SliderErrorMessageProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SliderPrimitive.ErrorMessage class={cn("text-xs text-destructive", local.class)} {...others} />
  );
};
