"use client";

import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef, CSSProperties, Ref } from "react";

import { cn } from "../../lib/cn";

const colorSwatchVariants = cva("inline-flex shrink-0 bg-(--swatch-color)", {
  defaultVariants: { shape: "circle", size: "md" },
  variants: {
    shape: { circle: "rounded-full", square: "rounded-xs" },
    size: { lg: "size-6", md: "size-3", sm: "size-2.5" },
  },
});

export const ColorSwatch = ({
  className,
  color,
  ref,
  shape,
  size,
  ...props
}: Omit<ComponentPropsWithoutRef<"span">, "color" | "style"> &
  VariantProps<typeof colorSwatchVariants> & {
    color: string;
    ref?: Ref<HTMLSpanElement>;
  }) => {
  const swatchStyle: CSSProperties & { "--swatch-color": string } = {
    "--swatch-color": color,
  };
  return (
    <span
      aria-hidden
      className={cn(colorSwatchVariants({ shape, size }), className)}
      ref={ref}
      style={swatchStyle}
      {...props}
    />
  );
};
