"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { domMax, LazyMotion, m, useReducedMotion } from "motion/react";
import { createContext, use } from "react";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";
import { Icon } from "./icon";

const switchVariants = cva(
  "squircle inline-flex shrink-0 items-center overflow-hidden rounded-full border border-border bg-switch-track transition-colors duration-150 ease-out focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-raised focus-visible:outline-none data-checked:border-primary data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50",
  {
    defaultVariants: { size: "default" },
    variants: {
      size: { default: "h-6 w-11 p-0.5", sm: "h-5 w-9 p-0.5" },
    },
  }
);

const switchThumbVariants = cva(
  "squircle block shrink-0 rounded-full bg-switch-thumb shadow-sm data-checked:ml-auto data-checked:bg-primary-fg",
  {
    defaultVariants: { size: "default" },
    variants: {
      size: {
        default: "size-4.5",
        sm: "size-3.5",
      },
    },
  }
);

type SwitchSize = NonNullable<VariantProps<typeof switchVariants>["size"]>;

/** Lets `SwitchThumb` match its track without callers passing the size twice. */
const SwitchSizeContext = createContext<SwitchSize>("default");

export type SwitchProps = ComponentPropsWithoutRef<
  typeof SwitchPrimitive.Root
> & {
  pending?: boolean;
  size?: SwitchSize;
};

export const Switch = ({
  className,
  children,
  pending = false,
  size = "default",
  ...props
}: SwitchProps) => (
  <LazyMotion features={domMax}>
    <SwitchSizeContext value={size}>
      <SwitchPrimitive.Root
        {...props}
        aria-busy={pending || undefined}
        className={cn(switchVariants({ size }), className)}
        disabled={pending || props.disabled}
      >
        {pending ? (
          <Icon
            aria-hidden
            size={14}
            animation="spin"
            tone="muted"
            className="mx-auto"
            icon={Loading03Icon}
          />
        ) : (
          children
        )}
      </SwitchPrimitive.Root>
    </SwitchSizeContext>
  </LazyMotion>
);

export const SwitchThumb = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SwitchPrimitive.Thumb>) => {
  const reducedMotion = useReducedMotion() === true;
  const size = use(SwitchSizeContext);
  return (
    <SwitchPrimitive.Thumb
      className={cn(switchThumbVariants({ size }), className)}
      render={
        <m.span
          layout={reducedMotion ? false : "position"}
          transition={{ layout: { bounce: 0, duration: 0.2, type: "spring" } }}
        />
      }
      {...props}
    />
  );
};
