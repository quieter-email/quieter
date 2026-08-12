"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { createContext, use } from "react";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

const switchVariants = cva(
  "squircle inline-flex shrink-0 items-center overflow-hidden rounded-full border border-border bg-muted transition-colors duration-150 ease-out focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none data-checked:border-primary data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50",
  {
    defaultVariants: { size: "default" },
    variants: {
      // Track padding is 2px, so travel is always `width - 4px - thumb`.
      size: { default: "h-6 w-11 p-0.5", sm: "h-5 w-9 p-0.5" },
    },
  }
);

const switchThumbVariants = cva(
  "squircle block rounded-full bg-bg-surface shadow-sm transition-transform duration-150 ease-out data-checked:bg-primary-fg",
  {
    defaultVariants: { size: "default" },
    variants: {
      size: {
        default: "size-5 data-checked:translate-x-5",
        sm: "size-4 data-checked:translate-x-4",
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
  <SwitchSizeContext value={size}>
    <SwitchPrimitive.Root
      {...props}
      aria-busy={pending || undefined}
      className={cn(switchVariants({ size }), className)}
      disabled={pending || props.disabled}
    >
      {pending ? (
        <HugeiconsIcon
          aria-hidden
          className="mx-auto size-3.5 animate-spin text-muted-fg"
          icon={Loading03Icon}
        />
      ) : (
        children
      )}
    </SwitchPrimitive.Root>
  </SwitchSizeContext>
);

export const SwitchThumb = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SwitchPrimitive.Thumb>) => (
  <SwitchPrimitive.Thumb
    className={cn(
      switchThumbVariants({ size: use(SwitchSizeContext) }),
      className
    )}
    {...props}
  />
);
